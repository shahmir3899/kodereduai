import React from 'react';
import { View } from 'react-native';
import { Tabs } from 'expo-router';
import Icon from '../../components/ui/Icon';
import RoleGuard from '../../components/nav/RoleGuard';
import { useTabScreenOptions } from '../../components/nav/tabBarStyle';
import { SideMenuProvider, useSideMenu } from '../../components/nav/SideMenuContext';
import SideMenu from '../../components/nav/SideMenu';
import MenuButton from '../../components/nav/MenuButton';

// The side menu is the admin's main way to reach every screen: the More tab opens it on a phone
// and it is a permanent rail on wide screens. The More page stays as the fallback route.
export default function AdminLayout() {
  return (
    <SideMenuProvider>
      <AdminTabs />
    </SideMenuProvider>
  );
}

function AdminTabs() {
  const screenOptions = useTabScreenOptions();
  const menu = useSideMenu();
  return (
    <RoleGuard persona="admin">
    <View style={{ flex: 1, flexDirection: 'row' }}>
    {menu.docked ? <SideMenu /> : null}
    <View style={{ flex: 1 }}>
    <Tabs
      screenOptions={screenOptions}
    >
      <Tabs.Screen
        name="dashboard"
        options={{
          title: 'Dashboard',
          headerLeft: () => <MenuButton />,
          tabBarIcon: ({ color }) => <Icon name="grid-outline" size={22} color={color} />,
        }}
      />
      <Tabs.Screen
        name="attendance"
        options={{
          title: 'Attendance',
          headerShown: false,
          tabBarIcon: ({ color }) => <Icon name="camera-outline" size={22} color={color} />,
        }}
      />
      <Tabs.Screen
        name="finance"
        options={{
          title: 'Finance',
          headerShown: false,
          tabBarIcon: ({ color }) => <Icon name="cash-outline" size={22} color={color} />,
        }}
      />
      <Tabs.Screen
        name="students"
        options={{
          title: 'Students',
          headerShown: false,
          tabBarIcon: ({ color }) => <Icon name="school-outline" size={22} color={color} />,
        }}
      />
      <Tabs.Screen
        name="more"
        listeners={{ tabPress: (e) => { if (!menu.docked) { e.preventDefault(); menu.open(); } } }}
        options={{
          title: 'More',
          tabBarIcon: ({ color }) => <Icon name="menu-outline" size={22} color={color} />,
        }}
      />
      {/* Hidden screens — accessed via "More" or deep navigation */}
      <Tabs.Screen name="inbox" options={{ href: null }} />
      <Tabs.Screen name="messages" options={{ href: null, headerShown: false }} />
      <Tabs.Screen name="my-profile" options={{ href: null, title: 'My Profile' }} />
      <Tabs.Screen name="notifications" options={{ href: null, headerShown: false }} />
      <Tabs.Screen name="hr" options={{ href: null, headerShown: false }} />
      <Tabs.Screen name="hostel" options={{ href: null, headerShown: false }} />
      <Tabs.Screen name="transport" options={{ href: null, headerShown: false }} />
      <Tabs.Screen name="curriculum" options={{ href: null, headerShown: false }} />
      <Tabs.Screen name="lesson-plans" options={{ href: null, title: 'Lesson Plans' }} />
      <Tabs.Screen name="coverage" options={{ href: null, title: 'Curriculum Coverage' }} />
      <Tabs.Screen name="questions" options={{ href: null, title: 'Question Bank' }} />
      <Tabs.Screen name="papers" options={{ href: null, title: 'Question Papers' }} />
      <Tabs.Screen name="paper-builder" options={{ href: null, title: 'Paper Builder' }} />
      <Tabs.Screen name="worksheets" options={{ href: null, title: 'Worksheets' }} />
      <Tabs.Screen name="worksheet-builder" options={{ href: null, title: 'Worksheet' }} />
      <Tabs.Screen name="insights" options={{ href: null, title: 'Insights' }} />
      <Tabs.Screen name="exam-types" options={{ href: null, title: 'Exam Types' }} />
      <Tabs.Screen name="grade-scale" options={{ href: null, title: 'Grade Scale' }} />
      <Tabs.Screen name="sessions" options={{ href: null, title: 'Academic Sessions' }} />
      <Tabs.Screen name="session-terms" options={{ href: null, title: 'Terms' }} />
      <Tabs.Screen name="promotion-web" options={{ href: null, title: 'Promotion' }} />
      <Tabs.Screen name="school-setup-web" options={{ href: null, title: 'School Setup' }} />
      <Tabs.Screen name="settings" options={{ href: null, title: 'Settings' }} />
      <Tabs.Screen name="school-profile" options={{ href: null, title: 'School Profile' }} />
      <Tabs.Screen name="subjects" options={{ href: null, title: 'Subjects' }} />
      <Tabs.Screen name="users" options={{ href: null, title: 'Users and Roles' }} />
      <Tabs.Screen name="exam-groups" options={{ href: null, title: 'Date Sheets and Publishing' }} />
      <Tabs.Screen name="date-sheet" options={{ href: null, title: 'Date Sheet' }} />
      <Tabs.Screen name="exam-wizard" options={{ href: null, title: 'New Exams (several classes)' }} />
      <Tabs.Screen name="library" options={{ href: null, headerShown: false }} />
      <Tabs.Screen name="admissions" options={{ href: null, headerShown: false }} />
      <Tabs.Screen name="inventory" options={{ href: null, headerShown: false }} />
      <Tabs.Screen name="timetable" options={{ href: null, title: 'Timetable' }} />
      <Tabs.Screen name="calendar" options={{ href: null, title: 'Academic Calendar' }} />
      <Tabs.Screen name="timetable-periods" options={{ href: null, title: 'Periods and Breaks' }} />
      <Tabs.Screen name="results" options={{ href: null }} />
      <Tabs.Screen name="class-setup" options={{ href: null, title: 'Add and Edit Classes' }} />
      <Tabs.Screen name="classes" options={{ href: null, title: 'Classes' }} />
      <Tabs.Screen name="assignments" options={{ href: null, headerShown: false }} />
      <Tabs.Screen name="report-cards" options={{ href: null, title: 'Report Cards' }} />
      <Tabs.Screen name="assessments" options={{ href: null, title: 'Assessments' }} />
      <Tabs.Screen name="exams-manage" options={{ href: null, title: 'Exams' }} />
      <Tabs.Screen name="marks-entry" options={{ href: null, title: 'Marks Entry' }} />
      <Tabs.Screen name="ai-assistant" options={{ href: null }} />
      <Tabs.Screen name="face-attendance" options={{ href: null, headerShown: false }} />
    </Tabs>
    </View>
    {menu.docked ? null : <SideMenu />}
    </View>
    </RoleGuard>
  );
}
