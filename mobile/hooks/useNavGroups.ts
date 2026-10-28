import { useMemo } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { useMyInventory } from './useStaff';
import { buildAccountantNavigation, buildDriverNavigation, buildParentNavigation, buildStaffNavigation, buildStudentNavigation, type NavGroup } from '../navigation/navConfig';

// The signed-in role's nav groups, filtered by role and enabled modules (web rules, ported).
export function useNavGroups(): NavGroup[] {
  const {
    persona, effectiveRole, isModuleEnabled, isStaffLevel, isManager, isTeacher, isStaff,
    isDriver, isSchoolAdminNav,
  } = useAuth();
  // Staff only see Inventory when something is assigned to them, as on the web.
  const inventory = useMyInventory(persona === 'staff');
  const hasInventoryAssignments = (inventory.data ?? []).length > 0;
  return useMemo(
    () => persona === 'student' ? buildStudentNavigation() : persona === 'parent' ? buildParentNavigation() : persona === 'driver' ? buildDriverNavigation(isModuleEnabled) : persona === 'accountant' ? buildAccountantNavigation(isModuleEnabled) : buildStaffNavigation({
      persona, effectiveRole, isModuleEnabled, isStaffLevel, isManager, isTeacher, isStaff,
      isDriver, isSchoolAdminNav, hasInventoryAssignments,
    }),
    [persona, effectiveRole, isModuleEnabled, isStaffLevel, isManager, isTeacher, isStaff, isDriver, isSchoolAdminNav, hasInventoryAssignments],
  );
}
