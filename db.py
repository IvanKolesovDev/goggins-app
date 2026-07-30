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
    cur.execute(
        """
        CREATE TABLE IF NOT EXISTS clients (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER NOT NULL,
            contact TEXT NOT NULL,
            call_datetime TEXT,
            status TEXT NOT NULL DEFAULT 'new',
            description TEXT,
            position INTEGER NOT NULL DEFAULT 0,
            FOREIGN KEY (user_id) REFERENCES users (user_id) ON DELETE CASCADE
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


# ==== КЛИЕНТЫ (CRM) ====

def get_clients(user_id: int) -> List[Dict[str, Any]]:
    conn = get_connection()
    cur = conn.cursor()
    cur.execute(
        "SELECT * FROM clients WHERE user_id = ? ORDER BY position ASC, id ASC",
        (user_id,),
    )
    rows = cur.fetchall()
    conn.close()
    return [
        {
            "id": r["id"],
            "contact": r["contact"],
            "call_datetime": r["call_datetime"],
            "status": r["status"],
            "description": r["description"],
        }
        for r in rows
    ]


def add_client(
    user_id: int,
    contact: str,
    call_datetime: Optional[str] = None,
    status: str = "new",
    description: Optional[str] = None,
) -> int:
    conn = get_connection()
    cur = conn.cursor()
    get_or_create_user(user_id)
    cur.execute("SELECT COALESCE(MAX(position), -1) + 1 FROM clients WHERE user_id = ?", (user_id,))
    next_position = cur.fetchone()[0]
    cur.execute(
        """
        INSERT INTO clients (user_id, contact, call_datetime, status, description, position)
        VALUES (?, ?, ?, ?, ?, ?)
        """,
        (user_id, contact, call_datetime, status, description, next_position),
    )
    conn.commit()
    client_id = cur.lastrowid
    conn.close()
    return client_id


def update_client(client_id: int, **fields: Any) -> None:
    if not fields:
        return
    allowed = {"contact", "call_datetime", "status", "description", "position"}
    updates = {k: v for k, v in fields.items() if k in allowed}
    if not updates:
        return
    conn = get_connection()
    cur = conn.cursor()
    set_clause = ", ".join(f"{k} = ?" for k in updates)
    values = list(updates.values()) + [client_id]
    cur.execute(f"UPDATE clients SET {set_clause} WHERE id = ?", values)
    conn.commit()
    conn.close()


def delete_client(client_id: int) -> None:
    conn = get_connection()
    cur = conn.cursor()
    cur.execute("DELETE FROM clients WHERE id = ?", (client_id,))
    conn.commit()
    conn.close()


def update_client_status(client_id: int, status: str) -> None:
    update_client(client_id, status=status)


def sync_clients(user_id: int, clients: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    conn = get_connection()
    cur = conn.cursor()
    get_or_create_user(user_id)
    cur.execute("DELETE FROM clients WHERE user_id = ?", (user_id,))
    conn.commit()
    for position, client in enumerate(clients):
        cur.execute(
            """
            INSERT INTO clients (user_id, contact, call_datetime, status, description, position)
            VALUES (?, ?, ?, ?, ?, ?)
            """,
            (
                user_id,
                client.get("contact", "Без имени"),
                client.get("call_datetime"),
                client.get("status", "new"),
                client.get("description", ""),
                position,
            ),
        )
    conn.commit()
    conn.close()
    return get_clients(user_id)


# ==== ПОЛНОЕ СОСТОЯНИЕ (ЦЕЛЬ + ЗАДАЧИ + КЛИЕНТЫ) ====

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

    cur.execute(
        "SELECT * FROM clients WHERE user_id = ? ORDER BY position ASC, id ASC",
        (user_id,),
    )
    client_rows = cur.fetchall()
    clients = [
        {
            "id": c["id"],
            "contact": c["contact"],
            "call_datetime": c["call_datetime"],
            "status": c["status"],
            "description": c["description"],
        }
        for c in client_rows
    ]

    state = {
        "goal": {"id": goal["id"], "title": goal["title"]},
        "tasks": tasks,
        "progress": progress,
        "clients": clients,
    }
    conn.close()
    return state


def sync_full_state(
    user_id: int,
    goal_title: str,
    tasks: List[Dict[str, Any]],
    clients: Optional[List[Dict[str, Any]]] = None,
) -> Dict[str, Any]:
    """
    Полная синхронизация состояния плана и CRM пользователя.
    Клиент присылает актуальные списки задач/подзадач и клиентов целиком,
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

    if clients is not None:
        cur.execute("DELETE FROM clients WHERE user_id = ?", (user_id,))
        for position, client in enumerate(clients):
            cur.execute(
                """
                INSERT INTO clients (user_id, contact, call_datetime, status, description, position)
                VALUES (?, ?, ?, ?, ?, ?)
                """,
                (
                    user_id,
                    client.get("contact", "Без имени"),
                    client.get("call_datetime"),
                    client.get("status", "new"),
                    client.get("description", ""),
                    position,
                ),
            )

    conn.commit()
    conn.close()
    return get_full_state(user_id)
