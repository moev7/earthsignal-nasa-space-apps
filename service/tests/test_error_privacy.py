"""Science failures stay actionable; arbitrary transport exceptions stay private."""
import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch
from service.config import Config
from service.processing import ProcessingError
from service.run_job import main

class ErrorPrivacy(unittest.TestCase):
    def test_only_controlled_science_messages_cross_ipc(self):
        for error,expected in (
            (ProcessingError('INCOMPATIBLE_PAIR','Native ancillary metadata frequencyModes must match'),'Native ancillary metadata frequencyModes must match'),
            (RuntimeError('private URL https://user:password@example.org/?token=secret'),'Processing could not produce a verified compatible crop'),
        ):
            with self.subTest(error=type(error).__name__),tempfile.TemporaryDirectory() as directory:
                root=Path(directory); request=root/'request.json'; request.write_text('{}'); output=root/'output'; output.mkdir()
                with patch('service.run_job.Config.environment',return_value=Config(root,b'x'*32)),patch('resource.setrlimit'),patch('service.processing.process_job',side_effect=error),patch('sys.argv',['run_job',str(request),str(output)]):
                    self.assertEqual(main(),1)
                result=json.loads((output/'error.json').read_text())
                self.assertEqual(result['message'],expected)
                self.assertNotIn('password',json.dumps(result)); self.assertNotIn('token',json.dumps(result))
