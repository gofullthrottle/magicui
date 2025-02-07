import { exec } from "child_process";
import { promises as fs } from "fs";
import path from "path";
import { rimraf } from "rimraf";
import { registryItemSchema, type Registry } from "shadcn/registry";
import { z } from "zod";

import { examples } from "../registry/registry-examples";
import { lib } from "../registry/registry-lib";
import { ui } from "../registry/registry-ui";

const DEPRECATED_ITEMS = ["toast"];

const registry = {
  name: "Magic UI",
  homepage: "https://magicui.design",
  items: z.array(registryItemSchema).parse(
    [
      {
        name: "index",
        type: "registry:style",
        dependencies: [
          "tailwindcss-animate",
          "class-variance-authority",
          "lucide-react",
        ],
        registryDependencies: ["utils"],
        tailwind: {
          config: {
            plugins: [`require("tailwindcss-animate")`],
          },
        },
        cssVars: {},
        files: [],
      },
      ...ui,
      ...examples,
      ...lib,
    ].filter((item) => {
      return !DEPRECATED_ITEMS.includes(item.name);
    }),
  ),
} satisfies Registry;

async function buildRegistryIndex() {
  let index = `/* eslint-disable @typescript-eslint/ban-ts-comment */
/* eslint-disable @typescript-eslint/no-explicit-any */
// @ts-nocheck
// This file is autogenerated by scripts/build-registry.ts
// Do not edit this file directly.
import * as React from "react"

export const Index: Record<string, any> = {`;
  for (const item of registry.items) {
    const resolveFiles = item.files?.map((file) => `registry/${file.path}`);
    if (!resolveFiles) {
      continue;
    }

    const componentPath = item.files?.[0]?.path
      ? `@/registry/${item.files[0].path}`
      : "";

    index += `
  "${item.name}": {
    name: ${JSON.stringify(item.name)},
    description: ${JSON.stringify(item.description ?? "")},
    type: "${item.type}",
    registryDependencies: ${JSON.stringify(item.registryDependencies)},
    files: [${item.files?.map((file) => {
      const filePath = `registry/${typeof file === "string" ? file : file.path}`;
      const resolvedFilePath = path.resolve(filePath);
      return typeof file === "string"
        ? `"${resolvedFilePath}"`
        : `{
      path: "${filePath}",
      type: "${file.type}",
      target: "${file.target ?? ""}"
    }`;
    })}],
    component: ${
      componentPath
        ? `React.lazy(async () => {
      const mod = await import("${componentPath}")
      const exportName = Object.keys(mod).find(key => typeof mod[key] === 'function' || typeof mod[key] === 'object') || item.name
      return { default: mod.default || mod[exportName] }
    })`
        : "null"
    },
    meta: ${JSON.stringify(item.meta)},
  },`;
  }

  index += `
  }`;

  // Write style index.
  rimraf.sync(path.join(process.cwd(), "__registry__/index.tsx"));
  await fs.writeFile(path.join(process.cwd(), "__registry__/index.tsx"), index);
}

async function buildRegistryJsonFile() {
  // 1. Fix the path for registry items.
  const fixedRegistry = {
    ...registry,
    items: registry.items.map((item) => {
      const files = item.files?.map((file) => {
        return {
          ...file,
          path: `registry/${file.path}`,
        };
      });

      return {
        ...item,
        files,
      };
    }),
  };

  // 2. Write the content of the registry to `registry.json`
  rimraf.sync(path.join(process.cwd(), `registry.json`));
  await fs.writeFile(
    path.join(process.cwd(), `registry.json`),
    JSON.stringify(fixedRegistry, null, 2),
  );
}

async function buildRegistry() {
  // 1. Build the registry
  await new Promise((resolve, reject) => {
    const process = exec(
      `pnpm dlx shadcn build registry.json --output ./public/r/`,
    );

    process.on("exit", (code) => {
      if (code === 0) {
        resolve(undefined);
      } else {
        reject(new Error(`Process exited with code ${code}`));
      }
    });
  });

  // 2. Replace `@/registry/magicui/` with `@/components/magicui/` in all files
  const files = await fs.readdir(path.join(process.cwd(), "public/r"));

  await Promise.all(
    files.map(async (file) => {
      const content = await fs.readFile(
        path.join(process.cwd(), "public/r", file),
        "utf-8",
      );

      const registryItem = JSON.parse(content);

      // Replace `@/registry/magicui/` in files
      registryItem.files = registryItem.files?.map((file) => {
        if (file.content?.includes("@/registry/magicui")) {
          file.content = file.content?.replaceAll(
            "@/registry/magicui",
            "@/components/ui",
          );
        }
        return file;
      });

      // Write the file back
      await fs.writeFile(
        path.join(process.cwd(), "public/r", file),
        JSON.stringify(registryItem, null, 2),
      );
    }),
  );
}

try {
  console.log("🗂️ Building registry/__index__.tsx...");
  await buildRegistryIndex();

  console.log("💅 Building registry.json...");
  await buildRegistryJsonFile();

  console.log("🏗️ Building registry...");
  await buildRegistry();
} catch (error) {
  console.error(error);
  process.exit(1);
}
