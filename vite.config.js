import { defineConfig } from "vite";

// game.js is a plain script, so it never enters vite's module graph and edits to
// it go unnoticed. same for the sprites. watch them here and force a reload.
const reloadOnPlainFiles = {
  name: "reload-on-plain-files",
  handleHotUpdate({ file, server }) {
    const watched = [".js", ".css", ".png", ".ttf"];
    if (!watched.some((extension) => file.endsWith(extension))) return;

    server.config.logger.info(`reloading for ${file.split("/").pop()}`, { timestamp: true });
    server.ws.send({ type: "full-reload", path: "*" });
    return [];
  }
};

export default defineConfig({
  plugins: [reloadOnPlainFiles],
  server: { open: true }
});
