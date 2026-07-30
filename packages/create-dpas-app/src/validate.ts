/**
 * Project name and destination validation. Mirrors npm's package-name rules
 * closely enough for scaffolding; the goal is a name that will not break
 * `package.json`, imports, or the filesystem.
 */

export interface NameValidation {
  valid: boolean;
  problems: string[];
}

export function validateProjectName(name: string): NameValidation {
  const problems: string[] = [];
  if (name.length === 0) problems.push("name cannot be empty");
  if (name.length > 214) problems.push("name must be at most 214 characters");
  if (name !== name.toLowerCase()) problems.push("name must be lowercase");
  if (/^[._]/.test(name)) problems.push("name cannot start with a dot or underscore");
  if (name.trim() !== name) problems.push("name cannot contain leading or trailing spaces");
  if (name === "." || name === "..") problems.push(`"${name}" is not a valid name`);

  const scoped = /^@([a-z0-9-*~][a-z0-9-*._~]*)\/([a-z0-9-~][a-z0-9-._~]*)$/;
  const plain = /^[a-z0-9-~][a-z0-9-._~]*$/;
  if (name.length > 0 && !scoped.test(name) && !plain.test(name)) {
    problems.push(
      "name may only contain lowercase letters, digits, dots, hyphens and underscores (optionally @scope/name)",
    );
  }
  return { valid: problems.length === 0, problems };
}

/** The directory name for a (possibly scoped) package name. */
export function directoryFor(name: string): string {
  return name.startsWith("@") ? (name.split("/")[1] ?? name) : name;
}
