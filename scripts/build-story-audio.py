"""Prepare local CC0 recordings already downloaded into the supplied directory.

Usage: python3 scripts/build-story-audio.py /path/to/source-directory
Source URLs, licences and original hashes live in story-audio-sources.json.
Requires the existing ffmpeg installation; no runtime external audio requests.
"""
from pathlib import Path
import hashlib, json, subprocess, sys, zipfile

root = Path(__file__).resolve().parents[1]
source = Path(sys.argv[1])
dest = root / 'public/audio/story'
manifest = root / 'docs/internal/story-audio-sources.json'
data = json.loads(manifest.read_text())
for entry in data['sources']:
    file = source / entry['file']
    if hashlib.sha256(file.read_bytes()).hexdigest() != entry['originalSha256']:
        raise ValueError(f"Source hash mismatch: {entry['file']}")
with zipfile.ZipFile(source / 'rubble.zip') as archive:
    for name in ['bfh1_wood_breaking_02.ogg', 'bfh1_rock_falling_04.ogg', 'bfh1_rock_breaking_01.ogg']:
        matches = [entry for entry in archive.namelist() if Path(entry).name == name]
        if len(matches) != 1 or archive.read(matches[0]) != (source / name).read_bytes():
            raise ValueError(f"Extracted source mismatch: {name}")
dest.mkdir(parents=True, exist_ok=True)

def render(name, inputs, graph):
    command = ['ffmpeg', '-v', 'error', '-y']
    for path in inputs:
        command += ['-i', str(source / path)]
    command += ['-filter_complex', graph, '-map', '[out]', '-ar', '32000', '-ac', '2', '-codec:a', 'libmp3lame', '-b:a', '112k', str(dest / name)]
    subprocess.run(command, check=True)

# Slow, diffuse sustained pads; no triggered note sequence, reward jingle or beat.
render('orbital-ambience.mp3', ['heavenly.ogg'],
       '[0:a]atempo=0.8,highpass=f=70,lowpass=f=1600,aecho=0.8:0.8:330|570:0.22|0.14,atrim=0:40,afade=t=in:d=2,afade=t=out:st=38:d=2,volume=4,alimiter=limit=0.8:level=false[out]')
render('water-flow.mp3', ['water.flac'],
       '[0:a]highpass=f=110,lowpass=f=5800,afade=t=in:d=0.12,afade=t=out:st=1.6:d=0.5,atrim=0:2.1,volume=2,alimiter=limit=0.8:level=false[out]')
render('ground-shift.mp3', ['bfh1_wood_breaking_02.ogg','bfh1_rock_falling_04.ogg'],
       '[0:a]lowpass=f=1900,volume=0.65[a];[1:a]lowpass=f=950,volume=0.7,adelay=130|130[b];[a][b]amix=inputs=2:normalize=0,apad,atrim=0:2.5,afade=t=out:st=1.6:d=0.9,volume=4,alimiter=limit=0.8:level=false[out]')
render('collapse-materials.mp3', ['collapse.mp3','bfh1_rock_falling_04.ogg','bfh1_rock_breaking_01.ogg'],
       '[0:a]atrim=0:6,highpass=f=65,lowpass=f=6000,volume=0.75[a];[1:a]asetrate=32000,aresample=32000,volume=0.8,adelay=650|650[b];[2:a]lowpass=f=2100,volume=0.7,adelay=1300|1300[c];[a][b][c]amix=inputs=3:normalize=0,apad,atrim=0:6,afade=t=in:d=0.08,afade=t=out:st=4.2:d=1.8,alimiter=limit=0.8[out]')
render('orbital-wash.mp3', ['heavenly.ogg'],
       '[0:a]atrim=10:15,asetpts=PTS-STARTPTS,highpass=f=240,lowpass=f=3200,aecho=0.8:0.8:280|610:0.28|0.18,afade=t=in:d=0.8,afade=t=out:st=2.5:d=2.5,atrim=0:5,volume=2,alimiter=limit=0.8:level=false[out]')

for entry in data['assets']:
    file = root / 'public' / entry['src'].lstrip('/')
    entry.update(bytes=file.stat().st_size, sha256=hashlib.sha256(file.read_bytes()).hexdigest())
manifest.write_text(json.dumps(data, indent=2)+'\n')
print('Prepared',sum(entry['bytes'] for entry in data['assets']),'bytes of locally served audio')
