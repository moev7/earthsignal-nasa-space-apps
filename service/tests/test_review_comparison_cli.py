"""Private IO regression fixtures; native comparison exercised separately."""
import contextlib
import hashlib
import importlib.util
import io
import json
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[2]
EXAMPLE = ROOT / 'examples/optical-reference-development'
sys.path.insert(0, str(EXAMPLE))
spec = importlib.util.spec_from_file_location('comparison_cli', EXAMPLE / 'compare_review_drafts.py')
cli = importlib.util.module_from_spec(spec)
spec.loader.exec_module(cli)
sys.path.remove(str(EXAMPLE))

class ComparisonCliTests(unittest.TestCase):
    def test_pin_before_comparison_and_private_non_overwriting_artifact(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            for name, value in [('packet', {'schemaVersion':1}),('left', {'note':'private-A'}),('right', {'note':'private-B'})]:
                (root/name).write_text(json.dumps(value))
            pin=hashlib.sha256((root/'packet').read_bytes()).hexdigest()
            args=['--packet',str(root/'packet'),'--packet-pin',pin,'--left',str(root/'left'),'--right',str(root/'right'),'--output',str(root/'output')]
            out,err=io.StringIO(),io.StringIO()
            with patch.object(cli,'compare_reviews',return_value={'accuracyEstimated':False,'note':'private-result'}) as compare, contextlib.redirect_stdout(out),contextlib.redirect_stderr(err):
                wrong=args.copy();wrong[3]='0'*64
                self.assertEqual(cli.main(wrong),2);compare.assert_not_called()
                self.assertEqual(cli.main(args),0);self.assertEqual((root/'output').stat().st_mode & 0o777,0o600)
                original=(root/'output').read_bytes();self.assertEqual(cli.main(args),2);self.assertEqual((root/'output').read_bytes(),original)
                self.assertNotIn('private-',out.getvalue());self.assertNotIn('private-',err.getvalue())
                artifact=json.loads(original);self.assertEqual(artifact['packetFileSha256'],pin)
                self.assertEqual(artifact['leftFileSha256'],hashlib.sha256((root/'left').read_bytes()).hexdigest())

    def test_duplicate_keys_and_oversize_output_are_rejected(self):
        with tempfile.TemporaryDirectory() as temp:
            root=Path(temp)
            for name in ['packet','left','right']:(root/name).write_text('{}')
            pin=hashlib.sha256(b'{}').hexdigest()
            args=['--packet',str(root/'packet'),'--packet-pin',pin,'--left',str(root/'left'),'--right',str(root/'right'),'--output',str(root/'output')]
            (root/'left').write_text('{"a":1,"a":2}')
            with patch.object(cli,'compare_reviews') as compare, contextlib.redirect_stderr(io.StringIO()):
                self.assertEqual(cli.main(args),2);compare.assert_not_called()
            (root/'left').write_text('{}')
            with patch.object(cli,'compare_reviews',return_value={'x':'a'*(4*1024**2)}),contextlib.redirect_stderr(io.StringIO()):
                self.assertEqual(cli.main(args),2);self.assertFalse((root/'output').exists())

    def test_unicode_size_gate_matches_actual_ascii_writer_bytes(self):
        from service.tests.test_review_comparison import synthetic_packet, synthetic_review
        from service.benchmarks import reference_review as rr
        packet=synthetic_packet(320)
        left=synthetic_review(packet, 'A', [4]*640)
        right=synthetic_review(packet, 'B', [4]*640)
        for review in (left,right):
            for row in review['reviews']:
                for side in ('before','after'):row[side]['reason']='🌊'*330
        with tempfile.TemporaryDirectory() as temp:
            root=Path(temp)
            for name,value in [('packet',packet),('left',left),('right',right)]:
                raw=json.dumps(value,ensure_ascii=False).encode('utf-8')
                self.assertLess(len(raw),1024**2)
                (root/name).write_bytes(raw)
            pin=hashlib.sha256((root/'packet').read_bytes()).hexdigest()
            args=['--packet',str(root/'packet'),'--packet-pin',pin,'--left',str(root/'left'),'--right',str(root/'right'),'--output',str(root/'output')]
            with patch.object(rr,'_projected_metres',return_value=None),contextlib.redirect_stderr(io.StringIO()),contextlib.redirect_stdout(io.StringIO()):
                self.assertEqual(cli.main(args),2)
            self.assertFalse((root/'output').exists())
