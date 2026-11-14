"""
Общий остаток НАЛИЧНЫХ в кассе филиала, который владелец/админ задаёт вручную
и который дальше сам пересчитывается.

Как считается:
  • При установке остатка запоминаем: сумму, дату и «базу» — чистое движение
    наличных за эту дату на момент установки (нал. выручка + товары + доп.
    доходы наличными − расходы). Это нужно, чтобы то, что уже было записано
    за день ДО установки остатка, не посчиталось второй раз.
  • Текущий остаток = заданная сумма
        + движение наличных по всем дням начиная с даты установки
          (архив + текущая смена)
        − база.
  Пример: вчера поставили 10 000; сегодня наличных пришло 5 000, расходов
  3 000 → 10 000 + 5 000 − 3 000 = 12 000.

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


def _flows_since(branch: str, since_date: str) -> tuple[int, int]:
    """(движение наличных с since_date включительно, движение именно за since_date)."""
    since = _parse(since_date)
    total = on_date = 0
    days = list(load_archive().get(branch, {}).values())
    days.append(get_session(branch))
    for day in days:
        d = _parse(day.get("date", ""))
        if d is None or since is None or d < since:
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
    _, base = _flows_since(branch, anchor_date)
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


def get_cash_balance(branch: str) -> dict:
    entry = _read_json_locked(CASH_BALANCE_FILE).get(branch)
    if not entry:
        return {"set": False}
    total, _ = _flows_since(branch, entry["date"])
    delta = total - entry.get("base", 0)
    return {
        "set": True,
        "balance": entry["amount"] + delta,
        "amount": entry["amount"],
        "delta": delta,
        "set_date": entry["date"],
        "set_at": entry.get("set_at", ""),
    }
