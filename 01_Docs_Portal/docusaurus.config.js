// @ts-check

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const projectsRoot = path.resolve(__dirname, '..');
const excludedDirectories = new Set(['00_Template', path.basename(__dirname)]);
const usedRoutes = new Set();

function isDirectory(directoryPath) {
  return (
    fs.existsSync(directoryPath) && fs.statSync(directoryPath).isDirectory()
  );
}

function isFile(filePath) {
  return fs.existsSync(filePath) && fs.statSync(filePath).isFile();
}

function findProjectDocs(projectEntry) {
  const projectPath = path.join(projectsRoot, projectEntry.name);
  const nestedDocs = fs
    .readdirSync(projectPath, {withFileTypes: true})
    .filter(
      (entry) =>
        entry.isDirectory() &&
        !entry.name.startsWith('.') &&
        entry.name !== 'node_modules',
    )
    .map((entry) => ({
      repositoryName: entry.name,
      docsPath: path.join(projectPath, entry.name, 'docs'),
    }))
    .filter((repository) => isDirectory(repository.docsPath));

  for (const repository of nestedDocs) {
    const indexPath = path.join(repository.docsPath, 'index.md');

    if (!isFile(indexPath)) {
      throw new Error(`Required documentation index is missing: ${indexPath}`);
    }
  }

  const needsRepositoryLabel = nestedDocs.length > 1;

  return nestedDocs.map((repository) => ({
    name: needsRepositoryLabel
      ? `${projectEntry.name} / ${repository.repositoryName}`
      : projectEntry.name,
    sourceKey: `${projectEntry.name}/${repository.repositoryName}`,
    docsPath: repository.docsPath,
  }));
}

const projectDocs = fs
  .readdirSync(projectsRoot, {withFileTypes: true})
  .filter(
    (entry) =>
      entry.isDirectory() &&
      !entry.name.startsWith('.') &&
      !excludedDirectories.has(entry.name),
  )
  .flatMap(findProjectDocs)
  .sort(
    (a, b) =>
      a.name.localeCompare(b.name) || a.sourceKey.localeCompare(b.sourceKey),
  )
  .map((project) => {
    const hash = crypto
      .createHash('sha1')
      .update(project.sourceKey)
      .digest('hex')
      .slice(0, 8);
    const routeBase =
      project.name
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '') || `project-${hash}`;
    const route = usedRoutes.has(routeBase)
      ? `${routeBase}-${hash}`
      : routeBase;

    usedRoutes.add(route);

    return {
      ...project,
      id: `project-${hash}`,
      route,
    };
  });

const config = {
  title: 'Projects Docs',
  url: 'http://localhost:3000',
  baseUrl: '/',

  customFields: {
    projects: projectDocs.map((project) => ({
      name: project.name,
      to: `/${project.route}/`,
    })),
  },

  onBrokenLinks: 'warn',
  markdown: {
    format: 'detect',
    mermaid: true,
    hooks: {
      onBrokenMarkdownLinks: 'warn',
    },
  },

  themes: ['@docusaurus/theme-mermaid'],

  presets: [
    [
      'classic',
      {
        docs: {
          sidebarPath: './sidebars.js',
          routeBasePath: '/',
        },
        blog: false,
      },
    ],
  ],

  plugins: projectDocs.map((project) => [
    '@docusaurus/plugin-content-docs',
    {
      id: project.id,
      path: project.docsPath,
      routeBasePath: project.route,
      sidebarPath: require.resolve('./sidebars.js'),
    },
  ]),

  themeConfig: {
    navbar: {
      title: 'Projects Docs',
      items:
        projectDocs.length > 0
          ? [
              {
                label: 'Projects',
                position: 'left',
                items: projectDocs.map((project) => ({
                  type: 'docSidebar',
                  sidebarId: 'docsSidebar',
                  docsPluginId: project.id,
                  label: project.name,
                })),
              },
            ]
          : [],
    },
  },
};

module.exports = config;
