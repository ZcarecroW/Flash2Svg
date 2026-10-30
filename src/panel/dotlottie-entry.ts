// Separate bundle (panel/dotlottie.js), loaded when the panel previews a .lottie export (or a
// Lottie JSON in the dotLottie player): dotlottie-web, its WebAssembly in wasm/.
import { DotLottie } from "@lottiefiles/dotlottie-web";

(globalThis as { Flash2SvgDotLottie?: { DotLottie: typeof DotLottie } }).Flash2SvgDotLottie = { DotLottie };
