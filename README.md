<div align="center">

![Earthsignal](docs/images/earthsignal-banner.png)

# 🛰️ Earthsignal

### The ground under Tehran is sinking. You can't feel it. A satellite can.

An interactive story built on real NISAR radar data for NASA Space Apps 2026: *Dancing with the SARs*.

**[🌍 Step into the story →](https://nasa.r8volt.com)** · **[📑 View the showcase (PDF)](docs/Earthsignal_Showcase.pdf)**

<img src="docs/images/readme/city-3d.jpg" alt="The story's opening: a 3D model of a real south-west Tehran neighbourhood, built from mapped buildings and coloured by satellite-measured ground motion" width="100%" />

</div>

---

## 💧 The story

Scroll from a quiet street, down into the water beneath it, and back up into orbit.

1. **🕳️ The hidden cause.** Pump water out from under a city, and the ground slowly settles. Put the water back, and it may never rise again.
2. **🏘️ Why it matters.** Next-door neighbours sink at different speeds, and the roads and pipes between them feel the strain.
3. **📡 Seeing it from space.** NISAR sends a radar pulse, listens for the echo, comes back, and listens again. The difference reveals the change.
4. **📍 Back on real ground.** Real NISAR images of Tehran, and four months of the city sinking, one satellite pass at a time, as you scroll.
5. **🗼 Another path.** Tokyo once faced the same problem, and changed course.

<img src="docs/images/readme/timelapse.jpg" alt="The scroll-driven time-lapse: a NISAR map of south-west Tehran on 10 September 2026, with a chart showing one place 77 mm lower after 84 days" width="100%" />

<sub>⏱️ Scroll and the map moves through time: each step is a real NISAR pass, and the chart tracks how far one place has sunk.</sub>

## 🎮 Play it as a game

Prefer to play? The five-mission game, at [`/?mode=game`](https://nasa.r8volt.com/?mode=game), hands you the instruments. Pull a well valve, bend a pipe and catch a radar echo, while Echo, your co-pilot, keeps score. Collect all five findings to crack the city's secret.

<img src="docs/images/readme/game.jpg" alt="Game mode: a points counter, five mission buttons and a findings tracker above a 3D city with the headline 'The city keeps a secret. You have the instruments.'" width="100%" />

## 📉 What we found

- 🛰️ **36 NISAR radar pairs** over south-west Tehran, from 18 June to 21 October 2026.
- 🗺️ **About 1,240 km²** of ground measured.
- ⬇️ **The fastest neighbourhood is sinking about 30 cm a year.** That's about 10 cm in just four months.

These numbers describe the ground, not whether a building is safe. The data is still provisional, and the 3D city is an illustration.

## 🔭 More radar to explore

Three hand-checked radar views, each one shown exactly as the satellite recorded it:

- 🇮🇷 **Tehran**, NISAR, October 2026
- 🇨🇦 **Southern Manitoba**, RADARSAT Constellation Mission, February 2025
- 🧊 **The Canadian Arctic**, RADARSAT-1, March 1996

Want to go further? The radar processor in **Advanced tools** lets you find new scenes and inspect them pixel by pixel.

<table>
<tr>
<td width="45%"><img src="docs/images/readme/radar-study.jpg" alt="A reviewed Tehran NISAR study: the original radar pixels beside tools to pin and compare two cells, and a chart of values along one row" /></td>
<td width="55%"><img src="docs/images/readme/advanced-tools.jpg" alt="Advanced tools: search, a place-and-question view, a scientific explorer and the radar processor, opening on 'Follow a question to the evidence.'" /></td>
</tr>
<tr>
<td><sub>🔬 Pin two pixels and compare them, read along a row, and download what you find.</sub></td>
<td><sub>🧪 Advanced tools for researchers: follow a question all the way to the evidence.</sub></td>
</tr>
</table>

## 🙏 Data from

- **NISAR**: NASA and ISRO, via the Alaska Satellite Facility
- **RADARSAT-1 and the RADARSAT Constellation Mission**: Canadian Space Agency
- **Buildings**: © OpenStreetMap contributors

## 🛠️ Run it yourself

You need Node 22.13 or later.

```sh
npm ci
npm run dev   # then open http://127.0.0.1:5173
```

Curious how it works? See the [processing guide](docs/challenge-processing.md), [reproducibility notes](docs/reproducibility.md) and [contributing guide](CONTRIBUTING.md).

---

<div align="center">

**Made with 🌍 and a lot of radar echoes for NASA Space Apps 2026.**

<sub>An independent project. It does not imply NASA or ISRO endorsement.</sub>

</div>
