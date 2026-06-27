import "./styles/base.css";
import { App } from "./app.js";

const root = document.getElementById("app");
if (!root) throw new Error("#app mount point missing");

new App(root).start();
