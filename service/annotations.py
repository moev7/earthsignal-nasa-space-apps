"""Owner-private append-only human annotation records; never scientific labels."""
import json
import uuid
from .analysis import polygon, invalid
from .store import iso, Problem

LABELS = {'water-change','vegetation-change','surface-change','artifact','uncertain'}
_TRIM = '\t\n\v\f\r \u00a0\u1680\u2000\u2001\u2002\u2003\u2004\u2005\u2006\u2007\u2008\u2009\u200a\u2028\u2029\u202f\u205f\u3000\ufeff'


def validate_request(value):
    if (not isinstance(value,dict) or not {'label','note'} <= set(value) or
        set(value)-{'label','note','polygon'} or not isinstance(value['label'],str) or value['label'] not in LABELS or
        not isinstance(value['note'],str)):
        raise invalid('Supply a supported label and a note of 1–1000 characters')
    note = value['note'].strip(_TRIM)
    # Match the authoritative Zod/JavaScript UTF-16 length and trim semantics.
    if (any(0xd800 <= ord(c) <= 0xdfff for c in note) or
        not 1 <= len(note.encode('utf-16-le'))//2 <= 1000):
        raise invalid('Supply a supported label and a note of 1–1000 characters')
    return dict(label=value['label'],note=note,polygon=polygon(value.get('polygon')))


class Annotations:
    def __init__(self,store):
        self.store = store
        with store.connect() as db:
            db.execute('''CREATE TABLE IF NOT EXISTS annotations (
                id TEXT PRIMARY KEY, job_id TEXT NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
                owner TEXT NOT NULL, version INTEGER NOT NULL, created REAL NOT NULL,
                label TEXT NOT NULL, note TEXT NOT NULL, polygon TEXT,
                UNIQUE(owner,job_id,version))''')

    @staticmethod
    def wire(row):
        return dict(id=row['id'],jobId=row['job_id'],createdAt=iso(row['created']),version=row['version'],
                    label=row['label'],note=row['note'],polygon=json.loads(row['polygon']) if row['polygon'] else None,
                    status='unverified-human-annotation')

    def list(self,user,job_id):
        self.store.get(user,job_id)
        with self.store.connect() as db:
            self.store.visible_row(db,user,job_id)
            return [self.wire(row) for row in db.execute(
                'SELECT * FROM annotations WHERE owner=? AND job_id=? ORDER BY version',(user,job_id))]

    def append(self,user,job_id,request):
        self.store.get(user,job_id)
        value = validate_request(request)
        # Versions are the owner's append sequence for this job, never edits to old records.
        with self.store.transaction() as db:
            self.store.visible_row(db,user,job_id)
            count = db.execute('SELECT COUNT(*) FROM annotations WHERE owner=? AND job_id=?',(user,job_id)).fetchone()[0]
            if count >= 100:
                raise Problem(429,'annotation_limit','Maximum 100 annotations per owner and comparison')
            record = uuid.uuid4().hex
            db.execute('INSERT INTO annotations VALUES(?,?,?,?,?,?,?,?)',
                       (record,job_id,user,count+1,self.store.clock(),value['label'],value['note'],
                        json.dumps(value['polygon'],allow_nan=False) if value['polygon'] else None))
            return self.wire(db.execute('SELECT * FROM annotations WHERE id=?',(record,)).fetchone())
