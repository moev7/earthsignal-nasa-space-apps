import unittest,json,hashlib
from pathlib import Path
from render import chunks,validate,cue_digest,MAX_CHUNK
class RenderContract(unittest.TestCase):
 def test_catalog_is_finite_reviewed_and_clauses_are_memory_bounded(self):
  catalog=json.loads((Path(__file__).parent.parent/'lib/echo-voice.json').read_text());validate(catalog)
  for cue,text in catalog['cues'].items():
   self.assertEqual(' '.join(text.split()),' '.join(chunks(text)))
   self.assertTrue(all(len(c)<=MAX_CHUNK for c in chunks(text)))
   self.assertEqual(len(cue_digest(catalog,cue)),64)
  changed=json.loads(json.dumps(catalog));changed['cues']['welcome']+=' Yes.'
  self.assertNotEqual(cue_digest(catalog,'welcome'),cue_digest(changed,'welcome'))
 def test_private_or_unbounded_inputs_are_rejected(self):
  with self.assertRaises(AssertionError):validate({'cues':{'../anything':'private'}})
if __name__=='__main__':unittest.main()
