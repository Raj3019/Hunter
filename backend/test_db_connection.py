from core.database import get_db

db = get_db()
result = db.table("jobs").select("count", count="exact").execute()
print(f"DB connection OK. Jobs in table: {result.count}")