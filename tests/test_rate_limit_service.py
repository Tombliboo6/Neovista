import pathlib
import sys
import unittest
from datetime import datetime

from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

REPO_ROOT = pathlib.Path(__file__).resolve().parents[1]
sys.path.insert(0, str(REPO_ROOT / "backend"))

from database import Base
from rate_limit_service import check_and_increment_ip_limit


class RateLimitServiceTest(unittest.TestCase):
    def setUp(self):
        self.engine = create_engine("sqlite:///:memory:", connect_args={"check_same_thread": False})
        self.Session = sessionmaker(bind=self.engine, autocommit=False, autoflush=False)
        Base.metadata.create_all(bind=self.engine)
        self.db = self.Session()

    def tearDown(self):
        self.db.close()
        self.engine.dispose()

    def test_ip_limit_blocks_after_threshold(self):
        now = datetime(2026, 4, 10, 9, 0, 0)

        count = check_and_increment_ip_limit(self.db, "1.1.1.1", "register", 1, now=now, period="day")
        self.assertEqual(count, 1)

        with self.assertRaises(ValueError):
            check_and_increment_ip_limit(self.db, "1.1.1.1", "register", 1, now=now, period="day")

    def test_hourly_bucket_resets_in_next_hour(self):
        first_hour = datetime(2026, 4, 10, 9, 0, 0)
        next_hour = datetime(2026, 4, 10, 10, 0, 0)

        count = check_and_increment_ip_limit(self.db, "2.2.2.2", "send_code", 1, now=first_hour, period="hour")
        self.assertEqual(count, 1)

        count = check_and_increment_ip_limit(self.db, "2.2.2.2", "send_code", 1, now=next_hour, period="hour")
        self.assertEqual(count, 1)


if __name__ == "__main__":
    unittest.main()
