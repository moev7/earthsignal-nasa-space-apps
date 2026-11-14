"""Operator source switching checks. Linux tests use real renameat2."""
import argparse
import hashlib
import importlib.util
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch

_parser=argparse.ArgumentParser(add_help=False)
_parser.add_argument('--recipe')
_options,_remaining=_parser.parse_known_args()
SCRIPT=Path(_options.recipe) if _options.recipe else Path(__file__).with_name('activate-science-86692bb.py')
spec=importlib.util.spec_from_file_location('activation',SCRIPT)
activation=importlib.util.module_from_spec(spec)
spec.loader.exec_module(activation)

@unittest.skipUnless(sys.platform=='linux','Atomic directory exchange requires Linux')
class SourceExchangeTests(unittest.TestCase):
    def setUp(self):
        self.tmp=tempfile.TemporaryDirectory()
        self.root=Path(self.tmp.name)
        self.paths=[self.root/name for name in ('live','new','old')]
        self.live,self.new,self.old=self.paths
        for path,content in ((self.live,'previous'),(self.new,'candidate')):
            path.mkdir();(path/'version').write_text(content)
        self.patches=[patch.object(activation,name,path) for name,path in zip(('LIVE','NEW','OLD'),self.paths)]
        for p in self.patches:p.start()

    def tearDown(self):
        for p in self.patches:p.stop()
        self.tmp.cleanup()

    def test_forward_and_rollback_preserve_both_sources(self):
        activation.activate_source()
        self.assertEqual((self.live/'version').read_text(),'candidate')
        self.assertEqual((self.old/'version').read_text(),'previous')
        activation.restore_source()
        self.assertEqual((self.live/'version').read_text(),'previous')
        self.assertEqual((self.new/'version').read_text(),'candidate')

    def test_backup_rename_failure_reverses_exchange(self):
        original=Path.rename
        def failing(path,target):
            if path==self.new:raise OSError('injected backup failure')
            return original(path,target)
        with patch.object(Path,'rename',failing),self.assertRaises(OSError):
            activation.activate_source()
        self.assertEqual((self.live/'version').read_text(),'previous')
        self.assertEqual((self.new/'version').read_text(),'candidate')

    def test_unsupported_exchange_has_no_partial_move(self):
        missing=self.root/'missing'
        with self.assertRaises(OSError):activation.exchange(self.live,missing)
        self.assertEqual((self.live/'version').read_text(),'previous')
        self.assertEqual((self.new/'version').read_text(),'candidate')

    def test_failed_compensation_never_restarts_candidate(self):
        real=activation.exchange
        calls=0
        def fail_compensation(left,right):
            nonlocal calls
            calls+=1
            if calls==2:raise OSError('injected compensation failure')
            return real(left,right)
        with patch.object(Path,'rename',side_effect=OSError('archive failure')),patch.object(activation,'exchange',side_effect=fail_compensation):
            with self.assertRaises(activation.SourceStateUncertain) as caught:activation.activate_source()
        with patch.object(activation,'start') as start,patch.object(activation,'command') as command:
            activation.recover_failure(caught.exception,False,False)
            start.assert_not_called();command.assert_not_called()
        self.assertEqual((self.live/'version').read_text(),'candidate')
        self.assertIn('manual inspection',activation.REPORT['status'])

    def test_hard_exit_between_exchange_and_archiving_keeps_live_source(self):
        code='import runpy,sys,os; m=runpy.run_path(sys.argv[1]); m["exchange"](sys.argv[2],sys.argv[3]); os._exit(9)'
        result=subprocess.run([sys.executable,'-c',code,str(SCRIPT),str(self.live),str(self.new)])
        self.assertEqual(result.returncode,9)
        self.assertEqual((self.live/'version').read_text(),'candidate')
        self.assertEqual((self.new/'version').read_text(),'previous')
        # An interrupted operator run still needs inspection. Never replay it.
        self.assertFalse(self.old.exists())

class RecoveryStatusTests(unittest.TestCase):
    def test_uncertain_restore_during_recovery_records_status_without_start(self):
        with patch.object(activation,'REPORT',{}),patch.object(activation,'start') as start,patch.object(activation,'command'),patch.object(activation,'restore_source',side_effect=activation.SourceStateUncertain('injected')):
            with self.assertRaises(activation.SourceStateUncertain):
                activation.recover_failure(RuntimeError('smoke failed'),True,False)
            start.assert_not_called()
            self.assertIn('manual inspection',activation.REPORT.get('status',''))

@unittest.skipUnless(hasattr(activation,'source_components'),'Recipe predates full source fingerprints')
class SourceFingerprintTests(unittest.TestCase):
    def setUp(self):
        self.tmp=tempfile.TemporaryDirectory()
        self.root=Path(self.tmp.name)
        for name in activation.SOURCE_COMPONENTS:
            if name in ('observatory/water_transitions.py','observatory/dswx_schema.py'):continue
            path=self.root/name
            path.parent.mkdir(parents=True,exist_ok=True)
            path.write_text(name)
        self.baseline=activation.source_components(self.root)

    def tearDown(self):self.tmp.cleanup()

    def test_missing_component_is_explicit_and_required_file_is_rejected(self):
        self.assertEqual(self.baseline['observatory/dswx_schema.py'],activation.ABSENT)
        (self.root/'assessment_validation.py').unlink()
        with self.assertRaisesRegex(RuntimeError,'assessment_validation.py'):
            activation.verify_source(self.root,self.baseline)
        self.assertNotEqual(activation.source_fingerprint(self.baseline),activation.source_fingerprint(activation.source_components(self.root)))

    def test_authored_file_replaces_absent_sentinel_and_empty_is_not_absent(self):
        path=self.root/'observatory/dswx_schema.py'
        path.write_bytes(b'')
        candidate=activation.source_components(self.root)
        self.assertEqual(candidate['observatory/dswx_schema.py'],hashlib.sha256(b'').hexdigest())
        self.assertNotEqual(activation.source_fingerprint(self.baseline),activation.source_fingerprint(candidate))
        with self.assertRaisesRegex(RuntimeError,'observatory/dswx_schema.py'):
            activation.verify_source(self.root,self.baseline)

    def test_changed_provider_changes_fingerprint_and_rejects_frozen_stage(self):
        (self.root/'observatory/providers.py').write_text('changed provider')
        candidate=activation.source_components(self.root)
        self.assertNotEqual(activation.source_fingerprint(self.baseline),activation.source_fingerprint(candidate))
        with self.assertRaisesRegex(RuntimeError,'observatory/providers.py'):
            activation.verify_source(self.root,self.baseline)

    def test_smoke_helpers_match_parent_fingerprint_in_separate_process(self):
        code=activation.fingerprint_code()+"\nimport sys\nprint(source_fingerprint(source_components(Path(sys.argv[1]))))"
        result=subprocess.run([sys.executable,'-c',code,str(self.root)],capture_output=True,text=True,check=True)
        self.assertEqual(result.stdout.strip(),activation.verify_source(self.root,self.baseline))

    def test_smoke_rejects_provider_drift_before_starting_process(self):
        (self.root/'observatory/providers.py').write_text('changed provider')
        with patch.object(activation,'LIVE',self.root),patch.object(activation.subprocess,'Popen') as process:
            with self.assertRaisesRegex(RuntimeError,'observatory/providers.py'):
                activation.smoke('observatory-1.6.0',self.baseline)
            process.assert_not_called()

    def test_relative_names_and_complete_inventory_bind_fingerprint(self):
        swapped=dict(self.baseline)
        swapped['run_job.py'],swapped['assessment_validation.py']=swapped['assessment_validation.py'],swapped['run_job.py']
        self.assertNotEqual(activation.source_fingerprint(self.baseline),activation.source_fingerprint(swapped))
        del swapped['observatory/dswx_schema.py']
        with self.assertRaisesRegex(RuntimeError,'Incomplete'):
            activation.source_fingerprint(swapped)

    def test_dangling_link_and_directory_are_not_absent_components(self):
        path=self.root/'observatory/dswx_schema.py'
        path.symlink_to(self.root/'missing')
        with self.assertRaisesRegex(RuntimeError,'Linked source component'):
            activation.source_components(self.root)
        path.unlink();path.mkdir()
        with self.assertRaisesRegex(RuntimeError,'Non-file source component'):
            activation.source_components(self.root)

if __name__=='__main__':unittest.main(argv=[sys.argv[0],*_remaining])
