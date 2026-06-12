/**
 * Native-style group picker built on Zenith's GroupsFilter.
 *
 * The data loader is fed ONLY the groups already returned by the user's
 * session (see fetchScopedGroups), so the picker can never offer a group the
 * user isn't entitled to. The proxy enforces scope a second time on the
 * server, but constraining the picker keeps the UI honest.
 */

import { useCallback, useMemo, useState } from "react";
import {
  GroupsFilter,
  RelationOperator,
  type IGroupItem,
  type IGroupsFilterTotalState,
  type IFilterState,
} from "@geotab/zenith";
import type { GeotabGroup } from "../types";

export interface GroupFilterPickerProps {
  groupsById: Map<string, GeotabGroup>;
  initialGroupIds?: string[];
  onChange: (groupIds: string[]) => void;
  onError?: (e: Error) => void;
}

/** Build the FLAT IGroupItem[] Zenith's GroupsFilter expects. */
function buildGroupItemArr(byId: Map<string, GeotabGroup>): IGroupItem[] {
  const items: IGroupItem[] = [];
  byId.forEach((g) => {
    items.push({
      id: g.id,
      name: g.name && g.name.length > 0 ? g.name : g.id,
      children:
        Array.isArray(g.children) && g.children.length > 0
          ? g.children.map((c) => ({ id: c.id }))
          : undefined,
    });
  });
  items.sort((a, b) => {
    if (a.id === "GroupCompanyId") return -1;
    if (b.id === "GroupCompanyId") return 1;
    return (a.name ?? "").localeCompare(b.name ?? "");
  });
  return items;
}

/** Walk an IFilterState recursively and pull out all leaf group IDs. */
function flattenIds(state: IFilterState | undefined): string[] {
  if (!state || !Array.isArray(state.items)) return [];
  const out: string[] = [];
  for (const item of state.items) {
    if (
      item &&
      typeof item === "object" &&
      "items" in item &&
      Array.isArray((item as IFilterState).items)
    ) {
      out.push(...flattenIds(item as IFilterState));
    } else if (
      item &&
      typeof item === "object" &&
      "id" in item &&
      typeof (item as { id: string }).id === "string"
    ) {
      out.push((item as { id: string }).id);
    }
  }
  return out;
}

export function GroupFilterPicker({
  groupsById,
  initialGroupIds,
  onChange,
  onError,
}: GroupFilterPickerProps) {
  const [state, setState] = useState<IGroupsFilterTotalState>(() => {
    const ids =
      initialGroupIds && initialGroupIds.length > 0
        ? initialGroupIds
        : ["GroupCompanyId"];
    return {
      groups: {
        relation: RelationOperator.OR,
        items: ids.map((id) => ({ id })),
      },
      sideWide: false,
    };
  });

  const dataLoader = useCallback(
    async (): Promise<IGroupItem[]> => buildGroupItemArr(groupsById),
    [groupsById]
  );

  const handleChange = useCallback(
    (next: IGroupsFilterTotalState) => {
      setState(next);
      onChange(flattenIds(next.groups));
    },
    [onChange]
  );

  const errorHandler = useCallback(
    (e: Error) => {
      console.error("[VT] GroupsFilter error:", e);
      onError?.(e);
    },
    [onError]
  );

  // Freeze the initial reference so GroupsFilter doesn't treat re-renders as
  // user-driven state changes.
  const initialFilterState = useMemo(() => state, []); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <GroupsFilter
      dataLoader={dataLoader}
      onChange={handleChange}
      errorHandler={errorHandler}
      initialFilterState={initialFilterState}
    />
  );
}
