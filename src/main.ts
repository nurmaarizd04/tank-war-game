import "./style.css";
import "./online.css";
import { Game } from "./game/game";
import { App } from "./ui/app";

const canvas = document.getElementById("game") as HTMLCanvasElement;
const overlay = document.getElementById("overlay") as HTMLCanvasElement;
const root = document.getElementById("ui")!;

let app: App | null = null;
const game = new Game(canvas, overlay, {
  hud: (state) => app?.updateHud(state),
  banner: (title, subtitle) => app?.showBanner(title, subtitle),
  gameOver: (result) => app?.showGameOver(result),
  killFeed: (killer, victim, killerLocal, victimLocal) => app?.killFeed(killer, victim, killerLocal, victimLocal),
  matchEnd: (rows) => app?.showMatchEnd(rows),
});
app = new App(root, game);

// Untuk pengujian: buka dengan ?debug agar objek game bisa diperiksa di console
if (new URLSearchParams(location.search).has("debug")) (window as unknown as { game: Game }).game = game;

// Pertempuran AI vs AI sebagai latar belakang menu
game.startDemo();
