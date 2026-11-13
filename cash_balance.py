"""
Общий остаток НАЛИЧНЫХ в кассе филиала, который владелец/админ задаёт вручную
и который дальше сам пересчитывается.

Как считается:
  • Заданная сумма — остаток на НАЧАЛО дня установки, БЕЗ налички, которая
    пришла в этот день. Поэтому наличные дня установки (и всех следующих
    дней) прибавляются сверху.
  • Текущий остаток = заданная сумма
        + движение наличных по всем дням начиная с даты установки
          (архив + текущая смена; движение = нал. выручка + товары + доп.
          доходы наличными − расходы).
  Пример: поставили 9 000; сегодня наличных пришло 5 000, расходов
  3 000 → 9 000 + 5 000 − 3 000 = 11 000. После закрытия смены завтрашний
  день прибавится так же.

В отчётах (PDF, сводка, Mini App) строка «Остаток» показывает именно этот
остаток — см. apply_cash_balance().

Зарплаты в расчёт НЕ входят — только расходы, внесённые в кассу.
"""
from datetime import datetime

from sessions import (
    DATA_DIR, _read_json_locked, _update_json_locked, get_session, load_archive,
)
from calculator import calculate_summary
import os

CASH_BALANCE_FILE = os.path.join(DATA_DIR, "carwash_cash_balance.json")
DATE_FMT = "%d.%m.%Y"


def _day_flow(day: dict) -> int:
    """Чистое движение наличных за день: нал. приход − расходы."""
    try:
        s = calculate_summary(day)
    except Exception:
        return 0
    return int(s.get("cash", 0)) - int(s.get("total_expenses", 0))


def _parse(date_str: str):
    try:
        return datetime.strptime(date_str, DATE_FMT)
    except (ValueError, TypeError):
        return None


def _flows_since(branch: str, since_date: str, until_date: str | None = None) -> tuple[int, int]:
    """(движение наличных с since_date включительно [и по until_date включительно],
    движение именно за since_date).

    Дни собираются по дате: если текущая смена имеет ту же дату, что и день
    в архиве (смену закрыли и открыли снова), берётся текущая — иначе день
    посчитался бы дважды."""
    since = _parse(since_date)
    until = _parse(until_date) if until_date else None
    by_date: dict[str, dict] = {}
    for day in load_archive().get(branch, {}).values():
        by_date[day.get("date", "")] = day
    cur = get_session(branch)
    by_date[cur.get("date", "")] = cur
    total = on_date = 0
    for date_str, day in by_date.items():
        d = _parse(date_str)
        if d is None or since is None or d < since:
            continue
        if until is not None and d > until:
            continue
        f = _day_flow(day)
        total += f
        if d == since:
            on_date += f
    return total, on_date


def set_cash_balance(branch: str, amount: int) -> dict:
    today = datetime.now().strftime(DATE_FMT)
    # якорная дата — дата текущей смены (если смена ещё не обновлена — сегодняшняя)
    anchor_date = get_session(branch).get("date") or today
    base = 0  # заданная сумма — до сегодняшней налички, она прибавляется сверху
    entry = {
        "amount": int(amount),
        "date": anchor_date,
        "base": base,
        "set_at": datetime.now().strftime("%d.%m.%Y %H:%M"),
    }

    def _upd(data):
        data[branch] = entry
        return data

    _update_json_locked(CASH_BALANCE_FILE, _upd)
    return get_cash_balance(branch)


def clear_cash_balance(branch: str) -> None:
    def _upd(data):
        data.pop(branch, None)
        return data
    _update_json_locked(CASH_BALANCE_FILE, _upd)


def get_cash_balance(branch: str, as_of: str | None = None) -> dict:
    """Остаток наличных. as_of — дата отчёта ДД.ММ.ГГГГ: остаток на конец
    этого дня (для отчётов за прошлые дни). Без as_of — актуальный."""
    entry = _read_json_locked(CASH_BALANCE_FILE).get(branch)
    if not entry:
        return {"set": False}
    if as_of:
        d, since = _parse(as_of), _parse(entry["date"])
        if d is None or since is None or d < since:
            return {"set": False}   # отчёт за день до установки остатка
    total, _ = _flows_since(branch, entry["date"], as_of)
    delta = total  # base игнорируем (в старых записях мог быть ненулевым)
    return {
        "set": True,
        "balance": entry["amount"] + delta,
        "amount": entry["amount"],
        "delta": delta,
        "set_date": entry["date"],
        "set_at": entry.get("set_at", ""),
    }


def apply_cash_balance(summary: dict, branch: str, date: str | None = None) -> dict:
    """Подставляет в summary['remainder'] актуальный остаток наличных в кассе
    (если он задан). Остаток за день сохраняется в summary['day_remainder'].
    Если остаток не задан — remainder остаётся прежним (нал за день − расходы)."""
    summary.setdefault("day_remainder", summary.get("remainder", 0))
    try:
        cb = get_cash_balance(branch, date) if branch else {"set": False}
    except Exception:
        cb = {"set": False}
    if cb.get("set"):
        summary["remainder"] = cb["balance"]
        summary["remainder_is_cash_balance"] = True
    return summary
