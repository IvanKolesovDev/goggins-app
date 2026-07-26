import sqlite3
from typing import Optional, List, Dict, Any

DB_PATH = "database.db"


def get_connection() -> sqlite3.Connection:
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    return conn


def init_db() -> None:
    conn = get_connection()
    cur = conn.cursor()
    cur.execute(
        """
        CREATE TABLE IF NOT EXISTS users (
            user_id INTEGER PRIMARY KEY,
            username TEXT,
            quiet_start TEXT NOT NULL DEFAULT '23:00',
            quiet_end TEXT NOT NULL DEFAULT '08:00',
            is_pro INTEGER NOT NULL DEFAULT 0,
            created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
        )
        """
    )
    cur.execute(
        """
        CREATE TABLE IF NOT EXISTS goals (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER NOT NULL,
            title TEXT NOT NULL DEFAULT 'Моя главная цель',
            is_main INTEGER NOT NULL DEFAULT 1,
            FOREIGN KEY (user_id) REFERENCES users (user_id) ON DELETE CASCADE
        )
        """
    )
    cur.execute(
        """
        CREATE TABLE IF NOT EXISTS tasks (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            goal_id INTEGER NOT NULL,
            title TEXT NOT NULL,
            deadline TEXT,
            priority TEXT NOT NULL DEFAULT 'secondary',
            done INTEGER NOT NULL DEFAULT 0,
            position INTEGER NOT NULL DEFAULT 0,
            FOREIGN KEY (goal_id) REFERENCES goals (id) ON DELETE CASCADE
        )
        """
    )
    cur.execute(
        """
        CREATE TABLE IF NOT EXISTS subtasks (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            task_id INTEGER NOT NULL,
            title TEXT NOT NULL,
            done INTEGER NOT NULL DEFAULT 0,
            position INTEGER NOT NULL DEFAULT 0,
            FOREIGN KEY (task_id) REFERENCES tasks (id) ON DELETE CASCADE
        )
        """
    )
    conn.commit()
    conn.close()


def get_or_create_user(user_id: int, username: Optional[str] = None) -> sqlite3.Row:
    conn = get_connection()
    cur = conn.cursor()
    cur.execute("SELECT * FROM users WHERE user_id = ?", (user_id,))
    row = cur.fetchone()
    if row is None:
        cur.execute(
            "INSERT INTO users (user_id, username) VALUES (?, ?)",
            (user_id, username),
        )
        conn.commit()
        cur.execute("SELECT * FROM users WHERE user_id = ?", (user_id,))
        row = cur.fetchone()
    conn.close()
    return row


def get_all_users() -> List[sqlite3.Row]:
    conn = get_connection()
    cur = conn.cursor()
    cur.execute("SELECT * FROM users")
    rows = cur.fetchall()
    conn.close()
    return rows


def set_quiet_hours(user_id: int, start: str, end: str) -> None:
    conn = get_connection()
    cur = conn.cursor()
    cur.execute(
        "UPDATE users SET quiet_start = ?, quiet_end = ? WHERE user_id = ?",
        (start, end, user_id),
    )
    conn.commit()
    conn.close()


def get_quiet_hours(user_id: int) -> Dict[str, str]:
    conn = get_connection()
    cur = conn.cursor()
    cur.execute(
        "SELECT quiet_start, quiet_end FROM users WHERE user_id = ?", (user_id,)
    )
    row = cur.fetchone()
    conn.close()
    if row is None:
        return {"quiet_start": "23:00", "quiet_end": "08:00"}
    return {"quiet_start": row["quiet_start"], "quiet_end": row["quiet_end"]}


def get_or_create_main_goal(user_id: int) -> sqlite3.Row:
    conn = get_connection()
    cur = conn.cursor()
    cur.execute(
        "SELECT * FROM goals WHERE user_id = ? AND is_main = 1", (user_id,)
    )
    row = cur.fetchone()
    if row is None:
        cur.execute(
            "INSERT INTO goals (user_id, title, is_main) VALUES (?, ?, 1)",
            (user_id, "Моя главная цель"),
        )
        conn.commit()
        cur.execute(
            "SELECT * FROM goals WHERE user_id = ? AND is_main = 1", (user_id,)
        )
        row = cur.fetchone()
    conn.close()
    return row


def _calc_progress_for_goal(cur: sqlite3.Cursor, goal_id: int) -> int:
    cur.execute("SELECT id, done FROM tasks WHERE goal_id = ?", (goal_id,))
    tasks = cur.fetchall()
    total = 0
    done = 0
    for task in tasks:
        cur.execute(
            "SELECT done FROM subtasks WHERE task_id = ?", (task["id"],)
        )
        subtasks = cur.fetchall()
        if subtasks:
            for st in subtasks:
                total += 1
                if st["done"]:
                    done += 1
        else:
            total += 1
            if task["done"]:
                done += 1
    if total == 0:
        return 0
    return round((done / total) * 100)


def calc_progress(user_id: int) -> int:
    conn = get_connection()
    cur = conn.cursor()
    goal = get_or_create_main_goal(user_id)
    progress = _calc_progress_for_goal(cur, goal["id"])
    conn.close()
    return progress


def get_full_state(user_id: int) -> Dict[str, Any]:
    conn = get_connection()
    cur = conn.cursor()
    get_or_create_user(user_id)
    goal = get_or_create_main_goal(user_id)

    cur.execute(
        "SELECT * FROM tasks WHERE goal_id = ? ORDER BY position ASC, id ASC",
        (goal["id"],),
    )
    task_rows = cur.fetchall()

    tasks = []
    for t in task_rows:
        cur.execute(
            "SELECT * FROM subtasks WHERE task_id = ? ORDER BY position ASC, id ASC",
            (t["id"],),
        )
        subtask_rows = cur.fetchall()
        subtasks = [
            {
                "id": s["id"],
                "title": s["title"],
                "done": bool(s["done"]),
            }
            for s in subtask_rows
        ]
        tasks.append(
            {
                "id": t["id"],
                "title": t["title"],
                "deadline": t["deadline"],
                "priority": t["priority"],
                "done": bool(t["done"]),
                "subtasks": subtasks,
            }
        )

    progress = _calc_progress_for_goal(cur, goal["id"])

    state = {
        "goal": {"id": goal["id"], "title": goal["title"]},
        "tasks": tasks,
        "progress": progress,
    }
    conn.close()
    return state


def sync_full_state(
    user_id: int, goal_title: str, tasks: List[Dict[str, Any]]
) -> Dict[str, Any]:
    """
    Полная синхронизация состояния плана пользователя.
    Клиент присылает актуальный список задач/подзадач целиком,
    бэкенд перезаписывает их и возвращает состояние с реальными ID.
    """
    conn = get_connection()
    cur = conn.cursor()

    get_or_create_user(user_id)
    goal = get_or_create_main_goal(user_id)
    goal_id = goal["id"]

    if goal_title:
        cur.execute("UPDATE goals SET title = ? WHERE id = ?", (goal_title, goal_id))

    cur.execute("DELETE FROM tasks WHERE goal_id = ?", (goal_id,))
    conn.commit()

    for position, task in enumerate(tasks):
        cur.execute(
            """
            INSERT INTO tasks (goal_id, title, deadline, priority, done, position)
            VALUES (?, ?, ?, ?, ?, ?)
            """,
            (
                goal_id,
                task.get("title", "Без названия"),
                task.get("deadline"),
                task.get("priority", "secondary"),
                1 if task.get("done") else 0,
                position,
            ),
        )
        task_id = cur.lastrowid
        subtasks = task.get("subtasks", [])
        for s_position, subtask in enumerate(subtasks):
            cur.execute(
                """
                INSERT INTO subtasks (task_id, title, done, position)
                VALUES (?, ?, ?, ?)
                """,
                (
                    task_id,
                    subtask.get("title", "Без названия"),
                    1 if subtask.get("done") else 0,
                    s_position,
                ),
            )

    conn.commit()
    conn.close()
    return get_full_state(user_id)
