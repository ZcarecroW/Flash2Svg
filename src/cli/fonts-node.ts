import * as fs from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { fontFiles, fontFolders, type FontFiles } from "../core/fonts.ts";

/** Installed font files, read with Node. */
export function nodeFontFiles(): FontFiles {
	return fontFiles(fs, join, fontFolders(process.platform, process.env, homedir(), join));
}
