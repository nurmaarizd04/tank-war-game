import { flagSvg } from "../data/flags";
import { STANDARD_TANKS, TANKS, isSecretCode, tankById, tankRatings, type TankModel } from "../data/tanks";
import { DIFFICULTIES, type Difficulty, type DifficultyId } from "../game/ai";
import { sound } from "../game/audio";
import type { Game, GameResult, HudState } from "../game/game";
import { music } from "../game/music";
import type { ScoreRow, VersusSettings } from "../game/protocol";
import { drawTankPreview } from "../game/sprites";
import { ClientSession, HostSession, MAX_PLAYERS, normalizeCode, type LobbyPlayer } from "../net/session";
import { TankPreview } from "../render/preview";

type ScreenId =
  | "menu"
  | "garage"
  | "secret"
  | "difficulty"
  | "help"
  | "online"
  | "lobby"
  | "pause"
  | "over"
  | "results"
  | "alert"
  | "none";
type Filter = "all" | "modern" | "ww2";
type GarageReturn = "menu" | "solo" | "lobby";

const ICONS = {
  back: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M15 18l-6-6 6-6"/></svg>`,
  pause: `<svg viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="5" width="4" height="14" rx="1"/><rect x="14" y="5" width="4" height="14" rx="1"/></svg>`,
  sfxOn: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 9v6h4l5 4V5L8 9H4z" fill="currentColor"/><path d="M16.5 8.5a5 5 0 0 1 0 7M19 6a8.5 8.5 0 0 1 0 12"/></svg>`,
  sfxOff: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 9v6h4l5 4V5L8 9H4z" fill="currentColor"/><path d="M17 9l5 6M22 9l-5 6"/></svg>`,
  musicOn: `<svg viewBox="0 0 24 24" fill="currentColor"><path d="M9 17.5V6l11-2v11.5"/><circle cx="6.5" cy="17.5" r="2.8"/><circle cx="17.5" cy="15.5" r="2.8"/><path d="M9 6l11-2v3L9 9z"/></svg>`,
  musicOff: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M9 17.5V6l11-2v11.5" /><circle cx="6.5" cy="17.5" r="2.5" fill="currentColor"/><circle cx="17.5" cy="15.5" r="2.5" fill="currentColor"/><path d="M3 3l18 18" stroke-width="2.4"/></svg>`,
  copy: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="12" height="12" rx="2"/><path d="M5 15V5a2 2 0 0 1 2-2h10"/></svg>`,
  key: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><circle cx="8" cy="15" r="4"/><path d="M10.8 12.2L20 3M16 7l3 3M14 9l2 2"/></svg>`,
  share: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><path d="M8.6 13.5l6.8 4M15.4 6.5l-6.8 4"/></svg>`,
};

const STORAGE = {
  tank: "tank-selected",
  difficulty: "tank-difficulty",
  best: "tank-best-score",
  name: "tank-name",
  secret: "tank-secret-unlocked",
};
const KILL_OPTIONS = [5, 10, 15, 20];
const TIME_OPTIONS = [180, 300, 480];

function load(key: string) {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function save(key: string, value: string) {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* abaikan */
  }
}

const escapeHtml = (text: string) => text.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
const formatTime = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;

/** Ukuran piksel kanvas mengikuti ukuran tampilannya agar tajam & tidak gepeng */
function fitCanvas(canvas: HTMLCanvasElement) {
  const rect = canvas.getBoundingClientRect();
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const w = Math.max(1, Math.round(rect.width * dpr));
  const h = Math.max(1, Math.round(rect.height * dpr));
  if (canvas.width !== w || canvas.height !== h) {
    canvas.width = w;
    canvas.height = h;
  }
}

async function enterFullscreen() {
  if (!matchMedia("(pointer: coarse)").matches) return;
  try {
    if (!document.fullscreenElement) await document.documentElement.requestFullscreen?.({ navigationUI: "hide" });
    await (screen.orientation as unknown as { lock?: (o: string) => Promise<void> }).lock?.("landscape");
  } catch {
    /* tidak didukung, abaikan */
  }
}

export class App {
  private readonly root: HTMLElement;
  private readonly game: Game;
  private screen: ScreenId = "menu";
  private tank: TankModel;
  private difficulty: Difficulty;
  private filter: Filter = "all";
  private garageReturn: GarageReturn = "menu";
  private bannerTimer = 0;
  private inBattle = false;
  private versus = false;
  private host: HostSession | null = null;
  private client: ClientSession | null = null;
  private preview: TankPreview | null = null;
  /** Tank rahasia sudah dibuka dengan kode (tersimpan di perangkat ini) */
  private secretUnlocked = load(STORAGE.secret) === "1";

  constructor(root: HTMLElement, game: Game) {
    this.root = root;
    this.game = game;
    this.tank = tankById(load(STORAGE.tank) ?? "harimau");
    if (this.tank.secret && !this.secretUnlocked) this.tank = tankById("harimau");
    this.difficulty = DIFFICULTIES.find((d) => d.id === (load(STORAGE.difficulty) as DifficultyId)) ?? DIFFICULTIES[1];
    root.innerHTML = this.markup();
    this.bind();
    this.renderGarageCards();
    this.renderDetail();
    this.renderToggles();
    this.$<HTMLInputElement>("#player-name").value = load(STORAGE.name) ?? `Pemain${Math.floor(Math.random() * 90 + 10)}`;

    game.onSnapshot = (s) => this.host?.sendSnapshot(s);
    game.onLocalInput = (ctrl) => this.client?.sendInput(ctrl);
    music.play("menu");

    // Link undangan: ?room=KODE
    const roomFromUrl = new URLSearchParams(location.search).get("room");
    if (roomFromUrl) {
      this.$<HTMLInputElement>("#room-code").value = normalizeCode(roomFromUrl);
      this.show("online");
      history.replaceState(null, "", location.pathname);
    } else this.show("menu");

    window.addEventListener("resize", () => this.redrawPreviews());
    document.fonts?.ready.then(() => this.redrawPreviews());
  }

  private $<T extends HTMLElement = HTMLElement>(selector: string) {
    return this.root.querySelector(selector) as T;
  }

  // ---------------- Markup ----------------

  private markup() {
    return `
    <section class="screen backdrop" id="screen-menu">
      <div class="menu-left">
        <h1 class="logo">TANK<br/>STRIKE</h1>
        <p class="tagline">Pertempuran Tank Dunia 3D</p>
        <div class="menu-actions">
          <button class="btn btn-primary" data-action="online">⚔ Main Bersama Teman</button>
          <button class="btn" data-action="solo">Latihan vs Komputer</button>
          <button class="btn" data-action="garage">Garasi</button>
          <button class="btn" data-action="help">Cara Main</button>
        </div>
        <div class="menu-stats">
          <span>Skor latihan terbaik: <b id="menu-best">0</b></span>
          <span>${STANDARD_TANKS.length} tank · ${new Set(STANDARD_TANKS.map((t) => t.country)).size} negara</span>
        </div>
      </div>
      <div class="menu-right">
        <div class="toggles">
          <button class="icon-btn" data-action="toggle-music" aria-label="Musik"></button>
          <button class="icon-btn" data-action="toggle-sfx" aria-label="Efek suara"></button>
        </div>
        <button class="menu-tank" data-action="garage" aria-label="Ganti tank">
          <div class="label">Tank kamu</div>
          <canvas id="menu-tank-canvas"></canvas>
          <div class="name" id="menu-tank-name"></div>
        </button>
      </div>
    </section>

    <section class="screen backdrop center-screen" id="screen-online">
      <div class="dialog online-dialog">
        <div class="dialog-head">
          <button class="icon-btn" data-action="menu" aria-label="Kembali">${ICONS.back}</button>
          <h2>Main Bersama Teman</h2>
        </div>
        <p class="sub">Semua lawan semua — hingga ${MAX_PLAYERS} pemain lewat internet.</p>
        <label class="field">Nama kamu
          <input id="player-name" maxlength="14" autocomplete="off" spellcheck="false" />
        </label>
        <div class="online-grid">
          <section>
            <h4>Buat room</h4>
            <p>Kamu jadi host. Bagikan kode ke teman-temanmu.</p>
            <button class="btn btn-primary" data-action="create">Buat Room</button>
          </section>
          <section>
            <h4>Gabung room</h4>
            <p>Masukkan kode 5 huruf dari temanmu.</p>
            <div class="join-row">
              <input id="room-code" maxlength="5" placeholder="KODE" autocomplete="off" spellcheck="false" />
              <button class="btn btn-primary" data-action="join">Gabung</button>
            </div>
          </section>
        </div>
        <p class="status" id="online-status"></p>
      </div>
    </section>

    <section class="screen backdrop panel-screen" id="screen-lobby">
      <div class="screen-head">
        <button class="icon-btn" data-action="leave" aria-label="Keluar room">${ICONS.back}</button>
        <h2>Lobi Pertempuran</h2>
        <div class="room-code">
          <span>KODE ROOM</span>
          <b id="lobby-code">-----</b>
          <button class="icon-btn" data-action="copy-code" aria-label="Salin kode">${ICONS.copy}</button>
          <button class="icon-btn" data-action="share-code" aria-label="Bagikan">${ICONS.share}</button>
        </div>
      </div>
      <div class="lobby">
        <div class="lobby-players">
          <div class="lobby-count" id="lobby-count"></div>
          <ul id="lobby-list"></ul>
        </div>
        <aside class="lobby-side">
          <div class="lobby-mytank">
            <canvas id="lobby-tank-canvas"></canvas>
            <div>
              <div class="label">Tank kamu</div>
              <div class="name" id="lobby-tank-name"></div>
              <button class="btn btn-small" data-action="lobby-garage">Ganti Tank</button>
            </div>
          </div>
          <div class="lobby-settings" id="lobby-settings">
            <div class="setting">
              <span>Target hancurkan</span>
              <div class="segmented">${KILL_OPTIONS.map((k) => `<button data-kill="${k}">${k}</button>`).join("")}</div>
            </div>
            <div class="setting">
              <span>Durasi</span>
              <div class="segmented">${TIME_OPTIONS.map((t) => `<button data-time="${t}">${t / 60} mnt</button>`).join("")}</div>
            </div>
          </div>
          <button class="btn btn-primary" id="btn-start" data-action="start-match">Mulai Pertempuran</button>
          <p class="status" id="lobby-status"></p>
        </aside>
      </div>
    </section>

    <section class="screen backdrop panel-screen" id="screen-garage">
      <div class="screen-head">
        <button class="icon-btn" data-action="garage-back" aria-label="Kembali">${ICONS.back}</button>
        <h2>Pilih Tank</h2>
        <div class="tabs">
          <button class="tab active" data-filter="all"></button>
          <button class="tab" data-filter="modern"></button>
          <button class="tab" data-filter="ww2"></button>
        </div>
        <button class="icon-btn secret-btn" data-action="secret" aria-label="Kode rahasia">${ICONS.key}</button>
      </div>
      <div class="garage">
        <div class="tank-grid" id="tank-grid"></div>
        <aside class="detail">
          <canvas id="detail-canvas"></canvas>
          <h3 id="detail-name"></h3>
          <div class="origin" id="detail-origin"></div>
          <p id="detail-desc"></p>
          <div class="stats" id="detail-stats"></div>
          <button class="btn btn-primary" data-action="choose">Pilih Tank Ini</button>
        </aside>
      </div>
    </section>

    <section class="screen backdrop center-screen" id="screen-secret">
      <div class="dialog secret-dialog">
        <div class="dialog-head">
          <button class="icon-btn" data-action="secret-back" aria-label="Kembali">${ICONS.back}</button>
          <h2>Kode Rahasia</h2>
        </div>
        <p class="sub">Punya kode? Masukkan untuk membuka tank tersembunyi.</p>
        <div class="join-row">
          <input id="secret-code" type="password" maxlength="24" placeholder="Kode" autocomplete="off" spellcheck="false" />
          <button class="btn btn-primary" data-action="unlock">Buka</button>
        </div>
        <p class="status" id="secret-status"></p>
      </div>
    </section>

    <section class="screen backdrop panel-screen" id="screen-difficulty">
      <div class="screen-head">
        <button class="icon-btn" data-action="garage" aria-label="Kembali">${ICONS.back}</button>
        <h2>Latihan: Pilih Kesulitan</h2>
      </div>
      <div class="difficulty-row">
        ${DIFFICULTIES.map(
          (d, i) => `
          <button class="diff-card" data-difficulty="${d.id}">
            <div class="stars">${"★".repeat(i + 1)}${"☆".repeat(2 - i)}</div>
            <h3>${d.name}</h3>
            <p>${d.description}</p>
            <div class="mult">Bonus skor ×${d.scoreMult}</div>
          </button>`,
        ).join("")}
      </div>
    </section>

    <section class="screen dim center-screen" id="screen-help">
      <div class="dialog">
        <h2>Cara Main</h2>
        <p class="sub">Main bersama teman: semua saling lawan — yang pertama mencapai target hancurkan menang!</p>
        <div class="help-grid">
          <section>
            <h4>📱 Di HP</h4>
            <ul>
              <li>Geser <b>sisi kiri</b> layar untuk bergerak.</li>
              <li>Geser <b>sisi kanan</b> untuk membidik — menembak otomatis.</li>
              <li><b>Ketuk</b> sisi kanan untuk menembak ke musuh terdekat.</li>
            </ul>
          </section>
          <section>
            <h4>💻 Di Laptop</h4>
            <ul>
              <li><b>WASD</b> / panah untuk bergerak.</li>
              <li><b>Mouse</b> untuk membidik, <b>klik</b> / <b>Spasi</b> untuk menembak.</li>
              <li><b>Esc</b> untuk menu jeda.</li>
            </ul>
          </section>
          <section>
            <h4>⚔ Main Bersama</h4>
            <ul>
              <li>Satu orang <b>Buat Room</b> lalu bagikan kodenya.</li>
              <li>Teman pilih <b>Gabung</b> dan masukkan kode (beda Wi-Fi pun bisa).</li>
              <li>Tank yang hancur <b>muncul lagi</b> dengan perisai sesaat.</li>
            </ul>
          </section>
          <section>
            <h4>🎯 Taktik & Item</h4>
            <ul>
              <li>Tembak <b>belakang</b> tank lawan = <b>KRITIS</b> (+40%).</li>
              <li>Tembak <b>tong merah</b> di dekat lawan untuk ledakan besar.</li>
              <li><b style="color:#3ddc84">Kotak hijau</b>: +35% HP · <b style="color:#ffc233">Kristal kuning</b>: tembak cepat.</li>
            </ul>
          </section>
        </div>
        <div class="dialog-actions"><button class="btn btn-primary" data-action="menu">Mengerti</button></div>
      </div>
    </section>

    <section class="screen" id="hud">
      <div class="hud-left">
        <div class="hud-tank" id="hud-tank"></div>
        <div class="hud-bar" id="hud-hp"><span></span><em></em></div>
        <div class="hud-reload" id="hud-reload"><span></span></div>
        <ol class="hud-board" id="hud-board"></ol>
      </div>
      <div class="hud-center">
        <div class="hud-wave" id="hud-wave"></div>
        <div class="hud-score" id="hud-score"></div>
        <div class="hud-enemies" id="hud-enemies"></div>
      </div>
      <div class="hud-right">
        <button class="icon-btn" data-action="toggle-music" aria-label="Musik"></button>
        <button class="icon-btn" data-action="toggle-sfx" aria-label="Efek suara"></button>
        <button class="icon-btn" data-action="pause" aria-label="Menu">${ICONS.pause}</button>
      </div>
      <ul class="killfeed" id="killfeed"></ul>
      <div class="respawn" id="respawn"></div>
      <div class="hud-hint" id="hud-hint"></div>
      <div id="banner"><div class="title"></div><div class="subtitle"></div></div>
    </section>

    <section class="screen dim center-screen" id="screen-pause">
      <div class="dialog">
        <h2 id="pause-title">Jeda</h2>
        <p class="sub" id="pause-info"></p>
        <div class="dialog-actions" id="pause-actions"></div>
      </div>
    </section>

    <section class="screen dim center-screen" id="screen-over">
      <div class="dialog">
        <h2>Tank Hancur!</h2>
        <p class="sub" id="over-sub"></p>
        <div class="result-grid">
          <div><b id="over-wave">0</b><span>Gelombang</span></div>
          <div><b id="over-kills">0</b><span>Tank dihancurkan</span></div>
          <div><b id="over-score">0</b><span>Skor</span></div>
        </div>
        <div id="over-best"></div>
        <div class="dialog-actions">
          <button class="btn btn-primary" data-action="restart">Main Lagi</button>
          <button class="btn" data-action="solo">Ganti Tank</button>
          <button class="btn" data-action="quit">Menu Utama</button>
        </div>
      </div>
    </section>

    <section class="screen dim center-screen" id="screen-results">
      <div class="dialog results-dialog">
        <h2 id="results-title">Pertandingan Selesai</h2>
        <p class="sub" id="results-sub"></p>
        <table class="scoreboard">
          <thead><tr><th>#</th><th>Pemain</th><th>Hancurkan</th><th>Hancur</th></tr></thead>
          <tbody id="results-body"></tbody>
        </table>
        <div class="dialog-actions" id="results-actions"></div>
      </div>
    </section>

    <section class="screen dim center-screen" id="screen-alert">
      <div class="dialog">
        <h2 id="alert-title">Ups!</h2>
        <p class="sub" id="alert-text"></p>
        <div class="dialog-actions"><button class="btn btn-primary" data-action="menu">OK</button></div>
      </div>
    </section>`;
  }

  private bind() {
    this.root.addEventListener("click", (e) => {
      const target = e.target as HTMLElement;
      const action = target.closest<HTMLElement>("[data-action]")?.dataset.action;
      const card = target.closest<HTMLElement>("[data-tank]");
      const filter = target.closest<HTMLElement>("[data-filter]")?.dataset.filter as Filter | undefined;
      const difficulty = target.closest<HTMLElement>("[data-difficulty]")?.dataset.difficulty as DifficultyId | undefined;
      const kill = target.closest<HTMLElement>("[data-kill]")?.dataset.kill;
      const time = target.closest<HTMLElement>("[data-time]")?.dataset.time;
      if (action || card || filter || difficulty || kill || time) {
        sound.unlock();
        sound.click();
      }
      if (card) this.selectTank(tankById(card.dataset.tank!));
      if (filter) this.setFilter(filter);
      if (difficulty) this.startSolo(DIFFICULTIES.find((d) => d.id === difficulty)!);
      if (kill && this.host) this.host.setSettings({ ...this.host.settings, killLimit: Number(kill) });
      if (time && this.host) this.host.setSettings({ ...this.host.settings, timeLimit: Number(time) });
      if (action) this.handleAction(action);
    });

    // Tombol Enter di kolom kode langsung bergabung
    this.$<HTMLInputElement>("#room-code").addEventListener("input", (e) => {
      const input = e.target as HTMLInputElement;
      input.value = normalizeCode(input.value);
    });
    this.$<HTMLInputElement>("#room-code").addEventListener("keydown", (e) => {
      if (e.key === "Enter") this.joinRoom();
    });
    this.$<HTMLInputElement>("#secret-code").addEventListener("keydown", (e) => {
      if (e.key === "Enter") this.tryUnlock();
    });
    // Kolom teks butuh sentuhan normal (body memakai touch-action: none)
    for (const input of this.root.querySelectorAll("input")) input.addEventListener("pointerdown", (e) => e.stopPropagation());

    window.addEventListener("keydown", (e) => {
      if (e.key !== "Escape") return;
      if (this.screen === "none" && this.inBattle) this.openPause();
      else if (this.screen === "pause") this.resume();
    });

    document.addEventListener("visibilitychange", () => {
      if (document.hidden && this.screen === "none" && this.inBattle && !this.versus) this.openPause();
    });
  }

  private handleAction(action: string) {
    switch (action) {
      case "online":
        this.show("online");
        break;
      case "solo":
        if (this.inBattle) this.leaveBattle();
        this.openGarage("solo");
        break;
      case "garage":
        if (this.inBattle) this.leaveBattle();
        this.openGarage("menu");
        break;
      case "lobby-garage":
        this.openGarage("lobby");
        break;
      case "garage-back":
        this.show(this.garageReturn === "lobby" ? "lobby" : "menu");
        break;
      case "secret":
        this.openSecret();
        break;
      case "secret-back":
        this.show("garage");
        break;
      case "unlock":
        this.tryUnlock();
        break;
      case "help":
        this.show("help");
        break;
      case "menu":
        if (this.screen === "alert") this.leaveOnline();
        this.show("menu");
        break;
      case "choose":
        this.chooseTank();
        break;
      case "create":
        void this.createRoom();
        break;
      case "join":
        void this.joinRoom();
        break;
      case "leave":
        this.leaveOnline();
        this.show("menu");
        break;
      case "copy-code":
        void this.copyInvite(false);
        break;
      case "share-code":
        void this.copyInvite(true);
        break;
      case "start-match":
        this.startMatch();
        break;
      case "rematch":
        this.startMatch();
        break;
      case "to-lobby":
        this.host?.backToLobby();
        this.inBattle = false;
        this.game.startDemo();
        music.play("menu");
        this.show("lobby");
        break;
      case "pause":
        this.openPause();
        break;
      case "resume":
        this.resume();
        break;
      case "restart":
        this.startSolo(this.difficulty);
        break;
      case "quit":
        if (this.versus) this.leaveOnline();
        else this.leaveBattle();
        this.show("menu");
        break;
      case "toggle-music":
        sound.setMusic(!sound.musicOn);
        this.renderToggles();
        break;
      case "toggle-sfx":
        sound.setSfx(!sound.sfxOn);
        this.renderToggles();
        break;
    }
  }

  // ---------------- Navigasi ----------------

  private show(id: ScreenId) {
    this.screen = id;
    for (const el of this.root.querySelectorAll<HTMLElement>(".screen")) {
      const active = el.id === `screen-${id}` || (el.id === "hud" && this.inBattle);
      el.classList.toggle("active", active);
    }
    if (id === "garage") {
      requestAnimationFrame(() => {
        this.redrawPreviews();
        this.$(".tank-card.selected")?.scrollIntoView({ block: "nearest" });
        this.preview ??= new TankPreview(this.$<HTMLCanvasElement>("#detail-canvas"));
        this.preview.show(this.tank);
        this.preview.start();
      });
    } else this.preview?.stop();
    if (id === "menu") requestAnimationFrame(() => this.renderMenu());
    if (id === "lobby") requestAnimationFrame(() => this.renderLobby());
  }

  private openGarage(returnTo: GarageReturn) {
    this.garageReturn = returnTo;
    (this.$("[data-action=choose]") as HTMLElement).textContent = returnTo === "solo" ? "Pilih & Lanjut" : "Pilih Tank Ini";
    this.show("garage");
  }

  private openSecret() {
    const input = this.$<HTMLInputElement>("#secret-code");
    const status = this.$("#secret-status");
    input.value = "";
    status.classList.remove("error");
    status.textContent = this.secretUnlocked ? "Tank rahasia sudah terbuka di perangkat ini." : "";
    this.show("secret");
    input.focus();
  }

  private tryUnlock() {
    const input = this.$<HTMLInputElement>("#secret-code");
    const status = this.$("#secret-status");
    if (!isSecretCode(input.value)) {
      status.textContent = "Kode salah, coba lagi.";
      status.classList.add("error");
      // Ulangi animasi getar
      input.classList.remove("shake");
      void input.offsetWidth;
      input.classList.add("shake");
      return;
    }
    this.secretUnlocked = true;
    save(STORAGE.secret, "1");
    sound.fanfare();
    this.setFilter("all");
    this.selectTank(TANKS.find((t) => t.secret)!);
    this.show("garage");
    this.$(".tank-card.secret")?.classList.add("unlocked-now");
  }

  private chooseTank() {
    save(STORAGE.tank, this.tank.id);
    if (this.garageReturn === "solo") this.show("difficulty");
    else if (this.garageReturn === "lobby") {
      this.host?.setLocalTank(this.tank.id);
      this.client?.setTank(this.tank.id);
      this.show("lobby");
    } else this.show("menu");
  }

  private enterBattle(versus: boolean) {
    void enterFullscreen();
    this.inBattle = true;
    this.versus = versus;
    this.$("#hud").classList.toggle("versus", versus);
    this.$("#hud-tank").innerHTML = `${flagSvg(this.tank.flag)} ${this.tank.name}`;
    this.$("#killfeed").innerHTML = "";
    this.renderToggles();
    const hint = this.$("#hud-hint");
    hint.textContent = matchMedia("(pointer: coarse)").matches
      ? "Geser kiri untuk bergerak · Geser kanan untuk membidik & menembak"
      : "WASD untuk bergerak · Mouse untuk membidik · Klik untuk menembak";
    hint.classList.remove("hide");
    setTimeout(() => hint.classList.add("hide"), 6000);
    music.play("battle");
    this.show("none");
  }

  private startSolo(difficulty: Difficulty) {
    this.difficulty = difficulty;
    save(STORAGE.difficulty, difficulty.id);
    this.game.startSolo(this.tank, difficulty);
    this.enterBattle(false);
  }

  private leaveBattle() {
    this.inBattle = false;
    this.versus = false;
    this.game.paused = false;
    this.game.startDemo();
    music.play("menu");
  }

  private openPause() {
    if (!this.versus) this.game.paused = true;
    this.$("#pause-title").textContent = this.versus ? "Menu" : "Jeda";
    this.$("#pause-info").textContent = this.versus ? "Pertempuran tetap berjalan untuk pemain lain." : `${this.tank.name} · ${this.difficulty.name}`;
    this.$("#pause-actions").innerHTML = this.versus
      ? `<button class="btn btn-primary" data-action="resume">▶ Lanjut</button><button class="btn" data-action="quit">Keluar dari Room</button>`
      : `<button class="btn btn-primary" data-action="resume">▶ Lanjut</button><button class="btn" data-action="restart">Ulangi</button><button class="btn" data-action="quit">Menu Utama</button>`;
    this.show("pause");
  }

  private resume() {
    this.game.paused = false;
    this.game.input.reset();
    this.show("none");
  }

  private alert(title: string, text: string) {
    this.$("#alert-title").textContent = title;
    this.$("#alert-text").textContent = text;
    this.show("alert");
  }

  // ---------------- Online ----------------

  private playerName() {
    const input = this.$<HTMLInputElement>("#player-name");
    const name = input.value.trim().slice(0, 14) || "Pemain";
    input.value = name;
    save(STORAGE.name, name);
    return name;
  }

  private setStatus(id: string, text: string, error = false) {
    const el = this.$(id);
    el.textContent = text;
    el.classList.toggle("error", error);
  }

  private async createRoom() {
    this.leaveOnline(false);
    this.setStatus("#online-status", "Membuat room…");
    try {
      const host = await HostSession.create(this.playerName(), this.tank.id);
      this.host = host;
      host.onLobby = () => this.renderLobby();
      host.onInput = (id, ctrl) => this.game.setRemoteInput(id, ctrl);
      host.onLeave = (id) => {
        this.game.removePlayer(id);
        if (this.inBattle && this.game.scoreRows().length < 2) this.showBanner("Semua lawan keluar", "Tunggu teman bergabung lagi di lobi");
      };
      host.onClosed = (message) => {
        this.leaveOnline();
        this.alert("Koneksi terputus", message);
      };
      this.setStatus("#online-status", "");
      this.show("lobby");
    } catch (err) {
      this.setStatus("#online-status", (err as Error).message, true);
    }
  }

  private async joinRoom() {
    const code = normalizeCode(this.$<HTMLInputElement>("#room-code").value);
    if (code.length !== 5) {
      this.setStatus("#online-status", "Masukkan kode room 5 karakter.", true);
      return;
    }
    this.leaveOnline(false);
    this.setStatus("#online-status", `Menghubungkan ke room ${code}…`);
    try {
      const client = await ClientSession.join(code, this.playerName(), this.tank.id);
      this.client = client;
      client.onLobby = () => {
        if (this.inBattle) {
          // Host kembali ke lobi setelah pertandingan
          this.inBattle = false;
          this.versus = false;
          this.game.startDemo();
          music.play("menu");
          this.show("lobby");
        } else if (this.screen === "results") this.show("lobby");
        else this.renderLobby();
      };
      client.onStart = (seed, players, settings) => {
        this.game.startVersus("client", seed, players, settings, client.localId);
        this.enterBattle(true);
      };
      client.onSnapshot = (s) => this.game.applySnapshot(s);
      client.onClosed = (message) => {
        this.leaveOnline();
        this.alert("Koneksi terputus", message);
      };
      this.setStatus("#online-status", "");
      this.show("lobby");
    } catch (err) {
      this.setStatus("#online-status", (err as Error).message, true);
    }
  }

  /** Tutup room/koneksi. Jika sedang bertempur, kembali ke latar demo. */
  private leaveOnline(resetGame = true) {
    this.host?.close();
    this.client?.close();
    this.host = null;
    this.client = null;
    if (resetGame && (this.inBattle || this.versus)) this.leaveBattle();
  }

  private get lobbyPlayers(): LobbyPlayer[] {
    return this.host?.players ?? this.client?.players ?? [];
  }

  private get lobbySettings(): VersusSettings {
    return this.host?.settings ?? this.client?.settings ?? { killLimit: 10, timeLimit: 300 };
  }

  private renderLobby() {
    const session = this.host ?? this.client;
    if (!session) return;
    const localId = this.host ? this.host.localId : this.client!.localId;
    const players = this.lobbyPlayers;
    const settings = this.lobbySettings;
    this.$("#lobby-code").textContent = session.code;
    this.$("#lobby-count").textContent = `${players.length} / ${MAX_PLAYERS} pemain`;
    this.$("#lobby-list").innerHTML = players
      .map((p) => {
        const model = tankById(p.tank);
        return `<li class="${p.id === localId ? "me" : ""}">
          ${flagSvg(model.flag)}
          <div><b>${escapeHtml(p.name)}</b><span>${model.name}</span></div>
          ${p.host ? `<em class="badge host">HOST</em>` : ""}${p.id === localId ? `<em class="badge">KAMU</em>` : ""}
        </li>`;
      })
      .join("");
    this.$("#lobby-tank-name").innerHTML = `${flagSvg(this.tank.flag)} ${this.tank.name}`;
    const canvas = this.$<HTMLCanvasElement>("#lobby-tank-canvas");
    fitCanvas(canvas);
    drawTankPreview(canvas, this.tank, -0.4, 0.2);

    const isHost = !!this.host;
    this.$("#lobby-settings").classList.toggle("readonly", !isHost);
    for (const b of this.root.querySelectorAll<HTMLElement>("[data-kill]")) b.classList.toggle("active", Number(b.dataset.kill) === settings.killLimit);
    for (const b of this.root.querySelectorAll<HTMLElement>("[data-time]")) b.classList.toggle("active", Number(b.dataset.time) === settings.timeLimit);
    const start = this.$<HTMLButtonElement>("#btn-start");
    start.hidden = !isHost;
    start.disabled = players.length < 2;
    this.setStatus(
      "#lobby-status",
      isHost
        ? players.length < 2
          ? "Bagikan kode room ke teman. Butuh minimal 2 pemain."
          : `${players.length} pemain siap. Mulai kapan saja!`
        : "Menunggu host memulai pertempuran…",
    );
  }

  private async copyInvite(share: boolean) {
    const session = this.host ?? this.client;
    if (!session) return;
    const url = `${location.origin}${location.pathname}?room=${session.code}`;
    const text = `Ayo main Tank Strike bareng! Kode room: ${session.code}`;
    if (share && navigator.share) {
      try {
        await navigator.share({ title: "Tank Strike", text, url });
        return;
      } catch {
        /* dibatalkan, lanjut salin */
      }
    }
    try {
      await navigator.clipboard.writeText(share ? `${text}\n${url}` : session.code);
      this.setStatus("#lobby-status", share ? "Link undangan disalin — tempel di WhatsApp/grup." : `Kode ${session.code} disalin.`);
    } catch {
      this.setStatus("#lobby-status", `Kode room: ${session.code}`);
    }
  }

  private startMatch() {
    const host = this.host;
    if (!host) return;
    if (host.players.length < 2) {
      this.setStatus("#lobby-status", "Butuh minimal 2 pemain untuk memulai.", true);
      if (this.screen !== "lobby") this.show("lobby");
      return;
    }
    const seed = Math.floor(Math.random() * 1e9);
    const players = host.start(seed);
    this.game.startVersus("host", seed, players, host.settings, host.localId);
    this.enterBattle(true);
  }

  // ---------------- Menu & garasi ----------------

  private renderToggles() {
    for (const b of this.root.querySelectorAll<HTMLElement>("[data-action=toggle-music]")) {
      b.innerHTML = sound.musicOn ? ICONS.musicOn : ICONS.musicOff;
      b.classList.toggle("off", !sound.musicOn);
    }
    for (const b of this.root.querySelectorAll<HTMLElement>("[data-action=toggle-sfx]")) {
      b.innerHTML = sound.sfxOn ? ICONS.sfxOn : ICONS.sfxOff;
      b.classList.toggle("off", !sound.sfxOn);
    }
  }

  private renderMenu() {
    this.$("#menu-best").textContent = (Number(load(STORAGE.best)) || 0).toLocaleString("id-ID");
    this.$("#menu-tank-name").innerHTML = `${flagSvg(this.tank.flag)} ${this.tank.name}`;
    const canvas = this.$<HTMLCanvasElement>("#menu-tank-canvas");
    fitCanvas(canvas);
    drawTankPreview(canvas, this.tank, -0.5, 0.15);
  }

  private setFilter(filter: Filter) {
    this.filter = filter;
    for (const tab of this.root.querySelectorAll<HTMLElement>("[data-filter]")) tab.classList.toggle("active", tab.dataset.filter === filter);
    this.renderGarageCards();
    this.redrawPreviews();
  }

  private renderGarageCards() {
    // Tank rahasia hanya muncul setelah dibuka, dan ditaruh paling depan
    const pool = this.secretUnlocked ? [...TANKS].sort((a, b) => Number(!!b.secret) - Number(!!a.secret)) : STANDARD_TANKS;
    const labels: Record<Filter, string> = { all: "Semua", modern: "Modern", ww2: "PD II" };
    for (const tab of this.root.querySelectorAll<HTMLElement>("[data-filter]")) {
      const filter = tab.dataset.filter as Filter;
      tab.textContent = `${labels[filter]} (${pool.filter((t) => filter === "all" || t.era === filter).length})`;
    }

    const list = pool.filter((t) => this.filter === "all" || t.era === this.filter);
    this.$("#tank-grid").innerHTML = list
      .map(
        (t) => `
        <button class="tank-card ${t.secret ? "secret" : ""} ${t.id === this.tank.id ? "selected" : ""}" data-tank="${t.id}">
          ${t.era === "ww2" ? `<span class="era-badge">PD II</span>` : ""}
          ${t.secret ? `<span class="era-badge secret-badge">★ RAHASIA</span>` : ""}
          <canvas></canvas>
          <div class="card-name">${t.name}</div>
          <div class="card-meta">${flagSvg(t.flag)} ${t.country}</div>
        </button>`,
      )
      .join("");
  }

  private selectTank(model: TankModel) {
    this.tank = model;
    for (const card of this.root.querySelectorAll<HTMLElement>(".tank-card")) card.classList.toggle("selected", card.dataset.tank === model.id);
    this.renderDetail();
    this.preview?.show(model);
  }

  private renderDetail() {
    const t = this.tank;
    const r = tankRatings(t);
    this.$("#detail-name").textContent = t.name;
    this.$("#detail-origin").innerHTML = `${flagSvg(t.flag)} ${t.country} · ${t.year} · ${t.era === "ww2" ? "Perang Dunia II" : "Modern"}`;
    this.$("#detail-desc").textContent = t.description;
    const rows: [string, number, string][] = [
      ["Daya tembak", r.firepower, String(Math.round(t.damage))],
      ["Lapis baja", r.armor, String(t.hp)],
      ["Kecepatan", r.mobility, String(t.speed)],
      ["Isi ulang", r.reload, `${t.reload}s`],
    ];
    this.$("#detail-stats").innerHTML = rows
      .map(([label, value, text]) => `<div class="stat">${label}<div class="bar"><span style="width:${Math.round(value * 100)}%"></span></div><b>${text}</b></div>`)
      .join("");
  }

  private redrawPreviews() {
    if (this.screen === "menu") this.renderMenu();
    if (this.screen === "lobby") this.renderLobby();
    for (const card of this.root.querySelectorAll<HTMLElement>(".tank-card")) {
      const canvas = card.querySelector("canvas")!;
      fitCanvas(canvas);
      drawTankPreview(canvas, tankById(card.dataset.tank!), -0.3);
    }
  }

  // ---------------- Dipanggil oleh Game ----------------

  updateHud(s: HudState) {
    const ratio = s.hp / s.maxHp;
    const hp = this.$("#hud-hp");
    hp.classList.toggle("low", ratio < 0.3);
    (hp.firstElementChild as HTMLElement).style.width = `${ratio * 100}%`;
    (hp.lastElementChild as HTMLElement).textContent = `${Math.ceil(s.hp)} / ${s.maxHp}`;
    const reload = this.$("#hud-reload");
    reload.classList.toggle("rapid", s.rapidFire > 0);
    (reload.firstElementChild as HTMLElement).style.width = `${s.reload * 100}%`;

    if (s.versus) {
      const rank = s.board.findIndex((r) => r.local) + 1;
      this.$("#hud-wave").textContent = `⏱ ${formatTime(s.timeLeft)}`;
      this.$("#hud-score").textContent = `${s.kills} / ${s.killLimit}`;
      this.$("#hud-enemies").textContent = rank ? `Peringkat ${rank} dari ${s.board.length}` : "";
      const top = s.board.slice(0, 3);
      const me = s.board.find((r) => r.local);
      if (me && !top.includes(me)) top.push(me);
      this.$("#hud-board").innerHTML = top
        .map((r) => `<li class="${r.local ? "me" : ""}"><span>${s.board.indexOf(r) + 1}</span><b>${escapeHtml(r.name)}</b><em>${r.kills}</em></li>`)
        .join("");
      const respawn = this.$("#respawn");
      respawn.classList.toggle("show", !s.alive);
      if (!s.alive) respawn.innerHTML = `Muncul kembali dalam <b>${Math.max(1, Math.ceil(s.respawnIn))}</b>`;
    } else {
      this.$("#hud-wave").textContent = s.wave ? `GELOMBANG ${s.wave}` : "BERSIAP";
      this.$("#hud-score").textContent = s.score.toLocaleString("id-ID");
      this.$("#hud-enemies").textContent = s.enemiesLeft ? `${s.enemiesLeft} musuh tersisa` : "";
    }
  }

  showBanner(title: string, subtitle: string) {
    const banner = this.$("#banner");
    (banner.querySelector(".title") as HTMLElement).textContent = title;
    (banner.querySelector(".subtitle") as HTMLElement).textContent = subtitle;
    banner.classList.add("show");
    clearTimeout(this.bannerTimer);
    this.bannerTimer = window.setTimeout(() => banner.classList.remove("show"), 2300);
  }

  killFeed(killer: string | null, victim: string, killerLocal: boolean, victimLocal: boolean) {
    const feed = this.$("#killfeed");
    const item = document.createElement("li");
    const name = (n: string, local: boolean) => `<b class="${local ? "me" : ""}">${escapeHtml(n)}</b>`;
    item.innerHTML = killer && killer !== victim ? `${name(killer, killerLocal)} <span>💥</span> ${name(victim, victimLocal)}` : `${name(victim, victimLocal)} <span>meledak</span>`;
    feed.prepend(item);
    while (feed.children.length > 5) feed.lastElementChild?.remove();
    setTimeout(() => item.remove(), 5000);
  }

  showGameOver(r: GameResult) {
    this.$("#over-sub").textContent = `${this.tank.name} · ${this.difficulty.name}`;
    this.$("#over-wave").textContent = String(r.wave);
    this.$("#over-kills").textContent = String(r.kills);
    this.$("#over-score").textContent = r.score.toLocaleString("id-ID");
    this.$("#over-best").innerHTML = r.newBest
      ? `<span class="new-best">🏆 Rekor Baru!</span>`
      : `<div class="best-line">Skor terbaik: ${r.best.toLocaleString("id-ID")}</div>`;
    this.show("over");
  }

  showMatchEnd(rows: ScoreRow[]) {
    const winner = rows[0];
    const me = rows.find((r) => r.local);
    this.$("#results-title").textContent = winner?.local ? "🏆 Kamu Menang!" : "Pertandingan Selesai";
    this.$("#results-sub").textContent = winner ? `${winner.local ? "Selamat!" : `Pemenang: ${winner.name}`} · ${winner.kills} tank dihancurkan` : "";
    this.$("#results-body").innerHTML = rows
      .map((r, i) => {
        const model = tankById(r.tank);
        return `<tr class="${r.local ? "me" : ""}"><td>${i === 0 ? "👑" : i + 1}</td><td><div class="who">${flagSvg(model.flag)}<b>${escapeHtml(r.name)}</b><span>${model.name}</span></div></td><td>${r.kills}</td><td>${r.deaths}</td></tr>`;
      })
      .join("");
    this.$("#results-actions").innerHTML = this.host
      ? `<button class="btn btn-primary" data-action="rematch">Main Lagi</button><button class="btn" data-action="to-lobby">Ke Lobi</button><button class="btn" data-action="quit">Keluar</button>`
      : `<p class="status">Menunggu host…</p><button class="btn" data-action="quit">Keluar</button>`;
    if (me) sound.fanfare();
    this.show("results");
  }
}
