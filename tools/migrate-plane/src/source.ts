/** What the importer reads: a plain snapshot of Plane (and ATC), so tests can use small fixtures. */
export interface PlaneState {
  id: string;
  name: string;
  group: string;
  sequence: number;
}
export interface PlaneLabel {
  id: string;
  name: string;
}
export interface AtcProject {
  columnKey: string;
  rank: string;
  repo: string | null;
  deploys: boolean;
  deployAction: string;
  bauEnabled: boolean;
  hidden: boolean;
}
export interface AtcCard {
  columnKey: string;
  columnRank: string;
  hidden: boolean;
}
export interface PlaneProject {
  id: string;
  identifier: string;
  name: string;
  description: string;
  createdAt: string;
  archived: boolean;
  states: PlaneState[];
  labels: PlaneLabel[];
  atc?: AtcProject;
  /** ATC's "unsorted" pseudo-module: the project's own card on the board. */
  atcProjectCard?: AtcCard;
}
export interface PlaneLink {
  id: string;
  url: string;
  title: string | null;
}
export interface PlaneIssue {
  id: string;
  projectId: string;
  sequence: number;
  name: string;
  html: string;
  priority: string;
  sortOrder: number;
  parentId: string | null;
  stateId: string | null;
  createdAt: string;
  updatedAt: string;
  createdByEmail: string | null;
  labelIds: string[];
  points: number | null;
  archived: boolean;
  links: PlaneLink[];
}
export interface PlaneComment {
  id: string;
  issueId: string;
  html: string;
  authorEmail: string | null;
  createdAt: string;
}
export interface PlaneRelation {
  issueId: string;
  relatedIssueId: string;
  type: string;
}
export interface PlaneModule {
  id: string;
  projectId: string;
  name: string;
  description: string;
  status: string | null;
  createdAt: string;
  createdByEmail: string | null;
  archived: boolean;
  /** Member issue ids in Plane's order (the issue's sort_order, then sequence). */
  issueIds: string[];
  atc?: AtcCard;
}
export interface PlaneData {
  projects: PlaneProject[];
  issues: PlaneIssue[];
  comments: PlaneComment[];
  relations: PlaneRelation[];
  modules: PlaneModule[];
}
