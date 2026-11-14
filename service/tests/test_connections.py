import sqlite3
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch
from service.config import Config
from service.store import Store

class ConnectionTests(unittest.TestCase):
    def test_read_and_transaction_connections_close_on_success_and_failure(self):
        with tempfile.TemporaryDirectory() as directory:
            store=Store(Config(Path(directory),b's'*32,reserve_bytes=0))
            captured=[];original=store._open_connection
            def open_db():
                db=original();captured.append(db);return db
            with patch.object(store,'_open_connection',side_effect=open_db):
                for _ in range(100):store.list('owner')
                with store.transaction() as db:db.execute('SELECT 1')
                with self.assertRaises(RuntimeError):
                    with store.transaction():raise RuntimeError('rollback')
                with self.assertRaises(RuntimeError):
                    with store.connect():raise RuntimeError('read failure')
            self.assertEqual(len(captured),103)
            for db in captured:
                with self.assertRaises(sqlite3.ProgrammingError):db.execute('SELECT 1')

if __name__=='__main__':unittest.main()
