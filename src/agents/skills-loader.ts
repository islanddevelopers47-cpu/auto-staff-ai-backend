import fs from "node:fs";
import path from "node:path";
import { createLogger } from "../utils/logger.js";

const log = createLogger("skills-loader");

export interface SkillDefinition {
  name: string;
  description: string;
  emoji?: string;
  homepage?: string;
  requires?: {
    bins?: string[];
    anyBins?: string[];
    env?: string[];
  };
  prompt: string;
  filePath: string;
}

const skillsCache: Map<string, SkillDefinition> = new Map();

/**
 * Parse YAML-ish frontmatter from a SKILL.md file.
 * We do a lightweight parse — no YAML lib needed.
 */
function parseFrontmatter(content: string): { frontmatter: Record<string, string>; body: string } {
  const frontmatter: Record<string, string> = {};
  const match = content.match(/^---\s*\n([\s\S]*?)\n---\s*\n([\s\S]*)$/);
  if (!match) {
    return { frontmatter, body: content };
  }

  const fmBlock = match[1]!;
  const body = match[2]!;

  // Parse simple key: value pairs from frontmatter
  for (const line of fmBlock.split("\n")) {
    const kvMatch = line.match(/^(\w[\w-]*):\s*(.+)/);
    if (kvMatch) {
      frontmatter[kvMatch[1]!] = kvMatch[2]!.trim();
    }
  }

  // Also try to capture multi-line metadata block as raw string
  const metadataMatch = fmBlock.match(/metadata:\s*\n([\s\S]*?)(?=\n\w|\n---|\Z)/);
  if (metadataMatch) {
    frontmatter["metadata_raw"] = metadataMatch[1]!;
  } else {
    const metaInline = fmBlock.match(/metadata:\s*(\{[\s\S]*?\})\s*$/m);
    if (metaInline) {
      frontmatter["metadata_raw"] = metaInline[1]!;
    }
  }

  return { frontmatter, body };
}

function parseMetadataBlock(raw: string | undefined): {
  emoji?: string;
  homepage?: string;
  requires?: { bins?: string[]; anyBins?: string[]; env?: string[] };
} {
  if (!raw) return {};

  try {
    // Try to find the openclaw metadata object
    // The metadata is JSON5-like, we'll parse it with JSON after cleanup
    let cleaned = raw.trim();

    // Handle the nested metadata format: { "openclaw": { ... } }
    // Try direct JSON parse first
    let parsed: any;
    try {
      parsed = JSON.parse(cleaned);
    } catch {
      // Try wrapping in braces if needed
      if (!cleaned.startsWith("{")) {
        cleaned = `{${cleaned}}`;
      }
      // Remove trailing commas before closing braces/brackets
      cleaned = cleaned.replace(/,\s*([}\]])/g, "$1");
      try {
        parsed = JSON.parse(cleaned);
      } catch {
        return {};
      }
    }

    // Navigate to the openclaw metadata
    const ocMeta = parsed?.openclaw ?? parsed?.["open-claw"] ?? parsed;

    return {
      emoji: ocMeta?.emoji,
      homepage: ocMeta?.homepage,
      requires: ocMeta?.requires
        ? {
            bins: Array.isArray(ocMeta.requires.bins) ? ocMeta.requires.bins : undefined,
            anyBins: Array.isArray(ocMeta.requires.anyBins) ? ocMeta.requires.anyBins : undefined,
            env: Array.isArray(ocMeta.requires.env) ? ocMeta.requires.env : undefined,
          }
        : undefined,
    };
  } catch {
    return {};
  }
}

/**
 * Load all skills from the skills directory.
 */
export function loadSkillsFromDir(skillsDir?: string): SkillDefinition[] {
  const dir = skillsDir ?? path.resolve(process.cwd(), "skills");
  if (!fs.existsSync(dir)) {
    log.info(`Skills directory not found: ${dir}`);
    return [];
  }

  const entries = fs.readdirSync(dir, { withFileTypes: true });
  const skills: SkillDefinition[] = [];

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;

    const skillFile = path.join(dir, entry.name, "SKILL.md");
    if (!fs.existsSync(skillFile)) continue;

    try {
      const content = fs.readFileSync(skillFile, "utf-8");
      const { frontmatter, body } = parseFrontmatter(content);

      const name = frontmatter["name"] ?? entry.name;
      const description = frontmatter["description"]?.replace(/^["']|["']$/g, "") ?? name;
      const homepage = frontmatter["homepage"];

      // Parse metadata block
      const metaRaw = frontmatter["metadata_raw"] ?? frontmatter["metadata"];
      const meta = parseMetadataBlock(metaRaw);

      const skill: SkillDefinition = {
        name,
        description,
        emoji: meta.emoji,
        homepage: homepage ?? meta.homepage,
        requires: meta.requires,
        prompt: body.trim(),
        filePath: skillFile,
      };

      skills.push(skill);
      skillsCache.set(name, skill);
    } catch (err) {
      log.warn(`Failed to load skill from ${entry.name}: ${err}`);
    }
  }

  log.info(`Loaded ${skills.length} skills from ${dir}`);
  return skills;
}

/**
 * Get a skill by name.
 */
export function getSkill(name: string): SkillDefinition | undefined {
  return skillsCache.get(name);
}

/**
 * Get all loaded skills.
 */
export function getAllSkills(): SkillDefinition[] {
  return Array.from(skillsCache.values());
}

/**
 * Build a skills prompt for an agent based on the skill names it has enabled.
 */
export function buildSkillsPrompt(skillNames: string[]): string {
  if (skillNames.length === 0) return "";

  const parts: string[] = [];
  for (const name of skillNames) {
    const skill = skillsCache.get(name);
    if (skill && skill.prompt) {
      parts.push(skill.prompt);
    }
  }

  if (parts.length === 0) return "";

  return "\n\n---\n\n# Skills\n\n" + parts.join("\n\n---\n\n");
}

/**
 * List skills in a compact format for API responses.
 */
export function listSkillsSummary(): Array<{
  name: string;
  description: string;
  emoji?: string;
  homepage?: string;
}> {
  return Array.from(skillsCache.values()).map((s) => ({
    name: s.name,
    description: s.description,
    emoji: s.emoji,
    homepage: s.homepage,
  }));
}
