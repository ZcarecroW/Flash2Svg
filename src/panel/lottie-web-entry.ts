// Separate bundle (panel/lottie-web.js), loaded when the panel previews a Lottie JSON export:
// lottie-web's SVG renderer (with effects; the "light" build has none).
import lottie from "lottie-web/build/player/esm/lottie_svg.min.js";

(globalThis as { Flash2SvgLottieWeb?: { lottie: typeof lottie } }).Flash2SvgLottieWeb = { lottie };
