"""Shared ledger and protected export limits have distinct write envelopes."""
import os,subprocess,sys,tempfile,unittest
from dataclasses import replace
from pathlib import Path
from service.config import Config
from service.run_job import file_size_limit
from service.observatory.vintages import MAX_BYTES

class FileBudgetTests(unittest.TestCase):
    def test_only_scoped_enabled_assessment_gets_ledger_envelope(self):
        cfg=replace(Config(Path('/tmp'),b'fixture'),gauge_vintages_enabled=True)
        self.assertEqual(file_size_limit(cfg,'assessment',True),MAX_BYTES)
        for kind,scoped in (('radar',True),('scenario',True),('assessment',False),(None,False)):
            self.assertEqual(file_size_limit(cfg,kind,scoped),8*1024**2)
        self.assertEqual(file_size_limit(replace(cfg,gauge_vintages_enabled=False),'assessment',True),8*1024**2)
        self.assertEqual(cfg.artifact_bytes,8*1024**2)

    def test_real_subprocess_can_write_valid_ledger_file_above_export_cap(self):
        with tempfile.TemporaryDirectory() as tmp:
            code='''import resource,sys
from pathlib import Path
from dataclasses import replace
from service.config import Config
from service.run_job import file_size_limit
root=Path(sys.argv[1]);cfg=replace(Config(root,b'fixture'),gauge_vintages_enabled=True)
limit=file_size_limit(cfg,'assessment',True)
resource.setrlimit(resource.RLIMIT_FSIZE,(limit,limit))
with (root/'ledger-envelope-check').open('wb') as stream:stream.write(b'x'*(cfg.artifact_bytes+1))
print((root/'ledger-envelope-check').stat().st_size)
'''
            result=subprocess.run([sys.executable,'-c',code,tmp],capture_output=True,text=True,timeout=10)
            self.assertEqual(result.returncode,0,result.stderr)
            self.assertEqual(int(result.stdout),8*1024**2+1)

if __name__=='__main__':unittest.main()
