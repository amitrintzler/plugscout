import { spawn } from 'node:child_process';
import { spawnSync } from 'node:child_process';

export interface SkillsRuntime {
  binary: string;
  prefixArgs: string[];
  label: string;
}

export function hasBinary(name: string): boolean {
  const result = spawnSync('which', [name], { encoding: 'utf8' });
  return result.status === 0;
}

export function resolveSkillsRuntime(): SkillsRuntime | null {
  if (hasBinary('skills')) {
    return {
      binary: 'skills',
      prefixArgs: [],
      label: 'skills'
    };
  }

  if (hasBinary('npx')) {
    return {
      binary: 'npx',
      prefixArgs: ['-y', 'skills'],
      label: 'npx skills'
    };
  }

  return null;
}

export function hasLegacySkillSh(): boolean {
  return hasBinary('skill.sh');
}

export async function installToolkitDependencies(): Promise<string[]> {
  const installed: string[] = [];

  if (!hasBinary('skills')) {
    if (!hasBinary('npm')) {
      throw new Error('npm is required to install the skills CLI automatically.');
    }

    if (process.env.SKILLS_MCPS_DEP_INSTALL_DRY_RUN === '1') {
      installed.push('skills');
      return installed;
    }

    await runCommand('npm', ['install', '-g', 'skills'], 'npm install -g skills');
    installed.push('skills');
  }

  return installed;
}

async function runCommand(binary: string, args: string[], label: string): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const child = spawn(binary, args, {
      stdio: 'inherit'
    });

    child.on('error', (error) => {
      reject(new Error(`Failed to execute ${label}: ${error.message}`));
    });

    child.on('close', (code) => {
      if ((code ?? 1) !== 0) {
        reject(new Error(`${label} exited with code ${code ?? 1}`));
        return;
      }
      resolve();
    });
  });
}
