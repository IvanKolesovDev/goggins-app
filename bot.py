import asyncio
import logging
import os
import random
from datetime import datetime, time as dtime

from aiogram import Bot, Dispatcher, F, Router
from aiogram.client.default import DefaultBotProperties
from aiogram.enums import ParseMode
from aiogram.filters import Command, CommandStart
from aiogram.fsm.context import FSMContext
from aiogram.fsm.state import State, StatesGroup
from aiogram.fsm.storage.memory import MemoryStorage
from aiogram.types import (
    Message,
    InlineKeyboardMarkup,
    InlineKeyboardButton,
    WebAppInfo,
    CallbackQuery,
    MenuButtonWebApp,
)

from aiohttp import web

import db
import quotes

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

BOT_TOKEN = os.getenv("BOT_TOKEN", "8847963266:AAFnc9iqleUWKv8msYY3ErLEQo_cRB3m2gE")
WEBAPP_URL = os.getenv("WEBAPP_URL", "https://ivankolesovdev.github.io/goggins-app/")
API_HOST = os.getenv("API_HOST", "0.0.0.0")
API_PORT = int(os.getenv("PORT", os.getenv("API_PORT", "8080")))

bot = Bot(token=BOT_TOKEN, default=DefaultBotProperties(parse_mode=ParseMode.HTML))
storage = MemoryStorage()
dp = Dispatcher(storage=storage)
router = Router()
dp.include_router(router)


class QuietHoursForm(StatesGroup):
    waiting_for_start = State()
    waiting_for_end = State()


def main_menu_keyboard() -> InlineKeyboardMarkup:
    return InlineKeyboardMarkup(
        inline_keyboard=[
            [
                InlineKeyboardButton(
                    text="Открыть план",
                    web_app=WebAppInfo(url=WEBAPP_URL),
                )
            ],
            [
                InlineKeyboardButton(
                    text="Настроить тихие часы",
                    callback_data="settings_quiet",
                )
            ],
        ]
    )


@router.message(CommandStart())
async def cmd_start(message: Message) -> None:
    db.get_or_create_user(message.from_user.id, message.from_user.username)
    db.get_or_create_main_goal(message.from_user.id)
    await message.answer(
        "Ты здесь не для того, чтобы чувствовать себя комфортно.\n"
        "Ты здесь, чтобы закрывать задачи и двигаться к цели. Каждый час.\n\n"
        "Открывай план и приступай к делу.",
        reply_markup=main_menu_keyboard(),
    )


@router.message(Command("plan"))
async def cmd_plan(message: Message) -> None:
    await message.answer(
        "Твой план ждёт тебя. Никаких отговорок.",
        reply_markup=main_menu_keyboard(),
    )


@router.message(Command("settings"))
async def cmd_settings(message: Message) -> None:
    await message.answer(
        "Настройки уведомлений.",
        reply_markup=main_menu_keyboard(),
    )


@router.message(Command("quiet"))
async def cmd_quiet(message: Message) -> None:
    parts = message.text.split()
    if len(parts) != 3:
        await message.answer(
            "Формат: /quiet 23:00 08:00\n"
            "Первое время — начало тихих часов, второе — конец. "
            "В это время уведомления не приходят."
        )
        return
    start_raw, end_raw = parts[1], parts[2]
    if not _is_valid_time(start_raw) or not _is_valid_time(end_raw):
        await message.answer("Неверный формат времени. Пример: /quiet 23:00 08:00")
        return
    db.set_quiet_hours(message.from_user.id, start_raw, end_raw)
    await message.answer(
        f"Готово. Тихие часы с {start_raw} до {end_raw}. В остальное время — жди."
    )


@router.callback_query(F.data == "settings_quiet")
async def cb_settings_quiet(callback: CallbackQuery, state: FSMContext) -> None:
    await callback.message.answer(
        "Во сколько начинаются тихие часы? Напиши время в формате ЧЧ:ММ (например 23:00)."
    )
    await state.set_state(QuietHoursForm.waiting_for_start)
    await callback.answer()


@router.message(QuietHoursForm.waiting_for_start)
async def process_quiet_start(message: Message, state: FSMContext) -> None:
    if not _is_valid_time(message.text.strip()):
        await message.answer("Неверный формат. Пример: 23:00. Попробуй ещё раз.")
        return
    await state.update_data(quiet_start=message.text.strip())
    await message.answer(
        "Во сколько тихие часы заканчиваются? Напиши время в формате ЧЧ:ММ (например 08:00)."
    )
    await state.set_state(QuietHoursForm.waiting_for_end)


@router.message(QuietHoursForm.waiting_for_end)
async def process_quiet_end(message: Message, state: FSMContext) -> None:
    if not _is_valid_time(message.text.strip()):
        await message.answer("Неверный формат. Пример: 08:00. Попробуй ещё раз.")
        return
    data = await state.get_data()
    quiet_start = data.get("quiet_start", "23:00")
    quiet_end = message.text.strip()
    db.set_quiet_hours(message.from_user.id, quiet_start, quiet_end)
    await message.answer(
        f"Готово. Тихие часы с {quiet_start} до {quiet_end}. В остальное время жди пуш и работай.",
        reply_markup=main_menu_keyboard(),
    )
    await state.clear()


def _is_valid_time(value: str) -> bool:
    try:
        h, m = value.split(":")
        return 0 <= int(h) <= 23 and 0 <= int(m) <= 59
    except (ValueError, AttributeError):
        return False


def _parse_hhmm(value: str) -> dtime:
    h, m = value.split(":")
    return dtime(hour=int(h), minute=int(m))


def _is_quiet_now(quiet_start: str, quiet_end: str, now: dtime) -> bool:
    start = _parse_hhmm(quiet_start)
    end = _parse_hhmm(quiet_end)
    if start <= end:
        return start <= now <= end
    return now >= start or now <= end


async def hourly_broadcast_loop() -> None:
    while True:
        try:
            now_time = datetime.utcnow().time().replace(second=0, microsecond=0)
            users = db.get_all_users()
            for user in users:
                quiet_start = user["quiet_start"]
                quiet_end = user["quiet_end"]
                if _is_quiet_now(quiet_start, quiet_end, now_time):
                    continue
                quote = random.choice(quotes.GOGGINS_QUOTES)
                text = quote
                try:
                    await bot.send_message(user["user_id"], text)
                except Exception as exc:
                    logger.warning(
                        "Не удалось отправить сообщение %s: %s", user["user_id"], exc
                    )
        except Exception as exc:
            logger.exception("Ошибка в hourly_broadcast_loop: %s", exc)

        await asyncio.sleep(3600)


def _cors_headers() -> dict:
    return {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type",
    }


async def handle_options(request: web.Request) -> web.Response:
    return web.Response(status=200, headers=_cors_headers())


async def handle_get_state(request: web.Request) -> web.Response:
    try:
        user_id = int(request.query.get("user_id", "0"))
    except ValueError:
        return web.json_response(
            {"error": "invalid user_id"}, status=400, headers=_cors_headers()
        )
    if not user_id:
        return web.json_response(
            {"error": "user_id required"}, status=400, headers=_cors_headers()
        )
    state = db.get_full_state(user_id)
    return web.json_response(state, headers=_cors_headers())


async def handle_sync_state(request: web.Request) -> web.Response:
    try:
        payload = await request.json()
    except Exception:
        return web.json_response(
            {"error": "invalid json"}, status=400, headers=_cors_headers()
        )

    user_id = payload.get("user_id")
    if not user_id:
        return web.json_response(
            {"error": "user_id required"}, status=400, headers=_cors_headers()
        )

    goal_title = payload.get("goal_title", "Моя главная цель")
    tasks = payload.get("tasks", [])

    state = db.sync_full_state(int(user_id), goal_title, tasks)
    return web.json_response(state, headers=_cors_headers())


async def handle_health(request: web.Request) -> web.Response:
    return web.json_response({"status": "ok"}, headers=_cors_headers())


def create_web_app() -> web.Application:
    app = web.Application()
    app.router.add_get("/api/health", handle_health)
    app.router.add_get("/api/state", handle_get_state)
    app.router.add_post("/api/sync", handle_sync_state)
    app.router.add_route("OPTIONS", "/api/state", handle_options)
    app.router.add_route("OPTIONS", "/api/sync", handle_options)
    return app


async def run_web_server() -> None:
    app = create_web_app()
    runner = web.AppRunner(app)
    await runner.setup()
    site = web.TCPSite(runner, API_HOST, API_PORT)
    await site.start()
    logger.info("API сервер запущен на http://%s:%s", API_HOST, API_PORT)
    while True:
        await asyncio.sleep(3600)


async def setup_menu_button() -> None:
    await bot.set_chat_menu_button(
        menu_button=MenuButtonWebApp(text="Открыть", web_app=WebAppInfo(url=WEBAPP_URL))
    )


async def main() -> None:
    db.init_db()
    await setup_menu_button()
    await asyncio.gather(
        dp.start_polling(bot),
        run_web_server(),
        hourly_broadcast_loop(),
    )


if __name__ == "__main__":
    asyncio.run(main())
