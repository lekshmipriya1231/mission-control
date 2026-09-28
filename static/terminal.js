/* MISSION CONTROL v1.0 — terminal client.
   Zero dependencies. Talks to the FastAPI backend; never to space APIs directly. */
"use strict";

const output = document.getElementById("output");
const input  = document.getElementById("cmd");
const history = [];
let histIdx = -1;
let trackTimer = null;

/* ------------------------------------------------------------- rendering helpers */

function print(text, cls = "") {
  const div = document.createElement("div");
  if (cls) div.className = cls;
  div.textContent = text;
  output.appendChild(div);
  scrollDown();
}

function printHTML(html) {
  const div = document.createElement("div");
  div.innerHTML = html;
  output.appendChild(div);
  scrollDown();
}

function scrollDown() { window.scrollTo(0, document.body.scrollHeight); }

async function api(path) {
  const resp = await fetch(path);
  const body = await resp.json().catch(() => ({}));
  if (!resp.ok) throw new Error(body.detail || `Relay error ${resp.status}`);
  return body;
}

const friendly = (e) => print(`ERROR: ${e.message}`, "error");

/* ------------------------------------------------------------- ASCII world map */
/* Equirectangular grid — no tiles, no network, works offline. */
function drawMap(lat, lon, canvas) {
  const W = (canvas.width = 520), H = (canvas.height = 260);
  const ctx = canvas.getContext("2d");
  const css = getComputedStyle(document.documentElement);
  const FG = css.getPropertyValue("--fg").trim();
  const DIM = css.getPropertyValue("--fg-dim").trim();

  ctx.fillStyle = "rgba(0,0,0,0.85)";
  ctx.fillRect(0, 0, W, H);

  ctx.strokeStyle = DIM; ctx.lineWidth = 1;
  // graticule every 30°
  for (let lonG = -180; lonG <= 180; lonG += 30) {
    const x = ((lonG + 180) / 360) * W;
    ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, H); ctx.stroke();
  }
  for (let latG = -60; latG <= 60; latG += 30) {
    const y = ((90 - latG) / 180) * H;
    ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke();
  }
  ctx.strokeStyle = FG;
  ctx.strokeRect(0, 0, W, H);

  // equator emphasised
  ctx.beginPath(); ctx.moveTo(0, H / 2); ctx.lineTo(W, H / 2); ctx.stroke();

  // ISS dot
  const x = ((lon + 180) / 360) * W;
  const y = ((90 - lat) / 180) * H;
  ctx.fillStyle = FG;
  ctx.shadowColor = FG; ctx.shadowBlur = 12;
  ctx.beginPath(); ctx.arc(x, y, 5, 0, Math.PI * 2); ctx.fill();
  ctx.shadowBlur = 0;

  ctx.font = "12px monospace"; ctx.fillStyle = FG;
  ctx.fillText(`ISS  ${lat.toFixed(2)}°, ${lon.toFixed(2)}°`, 8, H - 10);
}

/* ------------------------------------------------------------- commands */

const COMMANDS = {
  help: {
    usage: "help",
    desc: "List all available commands",
    run() {
      print("AVAILABLE COMMANDS", "section");
      for (const [name, c] of Object.entries(COMMANDS)) {
        print(`  ${c.usage.padEnd(18)} ${c.desc}`, "dim");
      }
      print("");
    },
  },

  iss: {
    usage: "iss | iss track",
    desc: "ISS position + map ('iss track' = live refresh)",
    async run(args) {
      if (args[0] === "track") return COMMANDS._track.run();
      const d = await api("/api/iss");
      print(`ISS POSITION  [${new Date(d.timestamp * 1000).toUTCString()}]`, "section");
      print(`  latitude   : ${d.latitude.toFixed(4)}°`);
      print(`  longitude  : ${d.longitude.toFixed(4)}°`);
      const canvas = document.createElement("canvas");
      output.appendChild(canvas);
      drawMap(d.latitude, d.longitude, canvas);
      scrollDown();
    },
  },

  _track: {
    usage: "iss track  (stop with 'stop')",
    desc: "internal",
    async run() {
      if (trackTimer) print("Tracking already active — refreshing view.");
      let canvas = output.querySelector("canvas.live-track");
      if (!canvas) {
        canvas = document.createElement("canvas");
        canvas.className = "live-track";
        output.appendChild(canvas);
        print("LIVE ISS TRACKING — refresh 3s — type 'stop' to end", "warn");
      }
      const tick = async () => {
        try {
          const d = await api("/api/iss");
          drawMap(d.latitude, d.longitude, canvas);
        } catch (e) { /* drop a frame silently, network may blip */ }
      };
      await tick();
      trackTimer = setInterval(tick, 3000);
      scrollDown();
    },
  },

  stop: {
    usage: "stop",
    desc: "Stop live ISS tracking",
    run() {
      if (trackTimer) { clearInterval(trackTimer); trackTimer = null; print("Tracking stopped.", "dim"); }
      else print("Nothing is tracking.", "dim");
    },
  },

  crew: {
    usage: "crew",
    desc: "People currently in space",
    async run() {
      const d = await api("/api/crew");
      print(`CREW MANIFEST — ${d.count} HUMANS IN SPACE`, "section");
      const byCraft = {};
      for (const p of d.people) (byCraft[p.craft] ??= []).push(p.name);
      for (const [craft, names] of Object.entries(byCraft)) {
        print(`  ${craft}`);
        for (const n of names) print(`    - ${n}`, "dim");
      }
      print("");
    },
  },

  apod: {
    usage: "apod",
    desc: "NASA Astronomy Picture of the Day",
    async run() {
      const d = await api("/api/apod");
      print(`APOD — ${d.date} — ${d.title}`, "section");
      if (d.media_type === "image") printHTML(`<img class="apod" src="${d.url}" alt="${d.title}">`);
      else print(`[video] ${d.url}`, "dim");
      print(d.explanation);
      print("");
    },
  },

  asteroids: {
    usage: "asteroids",
    desc: "Near-Earth asteroids passing this week",
    async run() {
      const d = await api("/api/asteroids");
      print(`NEO FEED — NEXT 7 DAYS — ${d.count} OBJECTS`, "section");
      for (const a of d.asteroids.slice(0, 20)) {
        const flag = a.hazardous ? "  ⚠ HAZARDOUS" : "";
        print(`${a.date}  ${a.name.padEnd(28)} ${String(a.diameter_m).padStart(6)} m  ` +
              `${String(a.speed_kmh).padStart(8)} km/h  ${String(a.distance_km).padStart(12)} km${flag}`);
      }
      if (d.count > 20) print(`  ... and ${d.count - 20} more. NASA keeps us busy.`, "dim");
      print("");
    },
  },

  danger: {
    usage: "danger",
    desc: "This week's most dangerous asteroid",
    async run() {
      const d = await api("/api/danger");
      const cls = { HIGH: "error", MODERATE: "warn", LOW: "dim" }[d.danger_level];
      print("THREAT ASSESSMENT", "section");
      print(`  object    : ${d.name}`);
      print(`  closest   : ${d.distance_km.toLocaleString()} km on ${d.date}`);
      print(`  size      : ~${d.diameter_m} m   speed: ${d.speed_kmh.toLocaleString()} km/h`);
      print(`  NASA flag : ${d.hazardous ? "potentially hazardous" : "not flagged"}`);
      print(`  DANGER LEVEL: ${d.danger_level}`, cls);
      print("");
    },
  },

  diary: {
    usage: "diary",
    desc: "Cosmo Polo's travel diary (from today's real data)",
    async run() {
      const d = await api("/api/diary");
      print(d.entry);
      print("");
    },
  },

  theme: {
    usage: "theme green | theme amber",
    desc: "Switch terminal color scheme",
    run(args) {
      const t = args[0];
      if (t !== "green" && t !== "amber") return print("Usage: theme green | theme amber", "dim");
      document.documentElement.dataset.theme = t;
      print(`Color scheme set to ${t.toUpperCase()}.`, "dim");
    },
  },

  clear: {
    usage: "clear",
    desc: "Clear the screen",
    run() {
      if (trackTimer) { clearInterval(trackTimer); trackTimer = null; }
      output.innerHTML = "";
    },
  },
};

/* ------------------------------------------------------------- input loop */

function exec(raw) {
  const line = raw.trim();
  print(`cosmo@asteria:~$ ${line}`, "cmd-echo");
  if (!line) return;
  history.unshift(line); histIdx = -1;

  const [cmd, ...args] = line.toLowerCase().split(/\s+/);
  const entry = COMMANDS[cmd];
  if (!entry || cmd.startsWith("_")) {
    return print(`Command not found. Type 'help'`, "error");
  }
  Promise.resolve(entry.run(args)).catch(friendly);
}

input.addEventListener("keydown", (e) => {
  if (e.key === "Enter") { exec(input.value); input.value = ""; }
  else if (e.key === "ArrowUp") {
    e.preventDefault();
    if (histIdx < history.length - 1) input.value = history[++histIdx];
  } else if (e.key === "ArrowDown") {
    e.preventDefault();
    if (histIdx > 0) input.value = history[--histIdx];
    else { histIdx = -1; input.value = ""; }
  }
});
document.addEventListener("click", () => input.focus());

/* ------------------------------------------------------------- boot sequence */

const BOOT = [
  "ASTEK SYSTEMS (R) BIOS  v4.02 — checksum OK",
  "Loading kernel image .................. DONE",
  "Mounting /dev/cosmo .................. DONE",
  "Deep-space relay handshake ........... ONLINE",
  "",
  "███ MISSION CONTROL v1.0 ███",
  "Asteria Orbital Station — retro uplink terminal",
  "Type 'help' to list commands.",
  "",
];

let bi = 0;
(function boot() {
  if (bi < BOOT.length) {
    if (BOOT[bi]) print(BOOT[bi], bi >= 5 ? "section" : "dim");
    bi++;
    setTimeout(boot, bi >= 5 ? 220 : 90);
  } else input.focus();
})();
