import React from 'react';
import Link from '@docusaurus/Link';
import useDocusaurusContext from '@docusaurus/useDocusaurusContext';

export default function ProjectLinks() {
  const {siteConfig} = useDocusaurusContext();
  const projects = siteConfig.customFields.projects;

  if (!Array.isArray(projects) || projects.length === 0) {
    return <p>No project documentation is available.</p>;
  }

  return (
    <ul>
      {projects.map((project) => (
        <li key={project.to}>
          <Link to={project.to}>{project.name}</Link>
        </li>
      ))}
    </ul>
  );
}
