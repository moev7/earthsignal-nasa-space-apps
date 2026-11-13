import unittest,json,hashlib
from pathlib import Path
from render import chunks,validate,cue_digest,MAX_SENTENCE
class RenderContract(unittest.TestCase):
 def test_catalog_is_finite_reviewed_and_clauses_are_memory_bounded(self):
  catalog=json.loads((Path(__file__).parent.parent/'lib/echo-voice.json').read_text());validate(catalog)
  for cue,text in catalog['cues'].items():
   self.assertEqual(' '.join(text.split()),' '.join(chunks(text)))
   self.assertTrue(all(len(c)<=MAX_SENTENCE for c in chunks(text)))
   self.assertEqual(len(cue_digest(catalog,cue)),64)
  changed=json.loads(json.dumps(catalog));changed['cues']['welcome']+=' Yes.'
  self.assertNotEqual(cue_digest(catalog,'welcome'),cue_digest(changed,'welcome'))
  changed=json.loads(json.dumps(catalog));changed['version']='previous-renderer'
  self.assertNotEqual(cue_digest(catalog,'welcome'),cue_digest(changed,'welcome'))
 def test_sentences_are_never_cut_to_fit_a_character_budget(self):
  # Each used to be split at 42 characters, giving its unfinished phrase a
  # sentence-final cadence and a forced pause before the remaining words.
  for text in [
   'Watch the street above the thin clay layer.',
   'The difference between the ends bends the connection.',
   'There is not going to be any rain tomorrow.',
   'Give the city another water route, or turn down its well.',
   'Changing a cause and checking a result are two different jobs.',
  ]:
   self.assertEqual(chunks(text),[text])
  self.assertEqual(chunks('Wait; the same sentence continues. Then stop.'),['Wait; the same sentence continues.','Then stop.'])
  self.assertEqual(chunks('A wavelength of 0.24 metres. Compare it.'),['A wavelength of 0.24 metres.','Compare it.'])
 def test_over_budget_sentence_is_rejected_instead_of_chopped(self):
  catalog=json.loads((Path(__file__).parent.parent/'lib/echo-voice.json').read_text())
  text='Keep the complete sentence together '+('a '*20)+'tomorrow.'
  self.assertGreater(len(text),MAX_SENTENCE)
  self.assertEqual(chunks(text),[text])
  catalog['cues']['welcome']=text
  with self.assertRaisesRegex(AssertionError,'never split it mid-phrase'):validate(catalog)
 def test_private_or_unbounded_inputs_are_rejected(self):
  with self.assertRaises(AssertionError):validate({'cues':{'../anything':'private'}})
if __name__=='__main__':unittest.main()
