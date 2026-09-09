import { getCollection, type CollectionEntry } from 'astro:content';
import { readSections } from './sections.ts';

export type RoleSlug = 'ai' | 'fullstack' | 'frontend' | 'backend' | 'cloud' | 'data';

/**
 * A reading path is a role's slice across every section, not a new taxonomy —
 * the roles themselves come straight from the `roles` frontmatter field in
 * `content.config.ts`. Adding a role there is the only other file this needs.
 */
export interface RoleMeta {
  slug: RoleSlug;
  label: string;
  description: string;
}

export const ROLES: RoleMeta[] = [
  {
    slug: 'ai',
    label: 'AI Engineer',
    description: 'Model behaviour, retrieval, agents, and evaluation.',
  },
  {
    slug: 'fullstack',
    label: 'Full-Stack Engineer',
    description: 'Frontend, backend, and everything that connects them.',
  },
  {
    slug: 'frontend',
    label: 'Frontend Engineer',
    description: 'The browser, the framework, and the interfaces built on both.',
  },
  {
    slug: 'backend',
    label: 'Backend Engineer',
    description: 'Services, data access, and the systems that keep them running.',
  },
  {
    slug: 'cloud',
    label: 'Cloud & Infrastructure Engineer',
    description: 'Provisioning, deployment, and the platforms underneath both.',
  },
  {
    slug: 'data',
    label: 'Data Engineer',
    description: 'Pipelines, storage, and modelling data at scale.',
  },
];

/**
 * Pages tagged for `role`, ordered by section order then by each page's
 * `sidebar.order` — the same ordering the sidebar and section indexes use, so
 * a path never invents a sequence the rest of the site doesn't already have.
 */
export async function pagesForRole(role: RoleSlug): Promise<CollectionEntry<'docs'>[]> {
  const sectionOrder = new Map(readSections().map((s) => [s.dir, s.order]));
  const pages = await getCollection('docs');

  return pages
    .filter((page) => page.data.roles?.includes(role))
    .sort((a, b) => {
      const [sectionA] = a.id.split('/');
      const [sectionB] = b.id.split('/');
      const orderA = sectionOrder.get(sectionA) ?? 999;
      const orderB = sectionOrder.get(sectionB) ?? 999;
      if (orderA !== orderB) return orderA - orderB;
      return (a.data.sidebar.order ?? 999) - (b.data.sidebar.order ?? 999);
    });
}
