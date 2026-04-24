import Reveal from "reveal.js";
import Highlight from "reveal.js/plugin/highlight";
import Notes from "reveal.js/plugin/notes";

const deck = new Reveal({
  hash: true,
  slideNumber: "c/t",
  controls: true,
  progress: true,
  transition: "slide",
  backgroundTransition: "fade",
  center: true,
  width: 1280,
  height: 820,
  margin: 0.09,
  minScale: 0.2,
  maxScale: 2.0,
  plugins: [Highlight, Notes],
});

deck.initialize();
