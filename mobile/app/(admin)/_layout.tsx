import React from 'react';
import { Tabs } from 'expo-router';
import { Text } from 'react-native';
import { Colors, FontSize } from '../../constants/colors';

export default function AdminLayout() {
  return (
    <Tabs
      screenOptions={{
        headerStyle: { backgroundColor: Colors.surface },
        headerTitleStyle: { fontWeight: '600', fontSize: FontSize.lg },
        headerTintColor: Colors.text,
        tabBarActiveTintColor: Colors.primary,
        tabBarInactiveTintColor: Colors.textTertiary,
        tabBarStyle: {
          backgroundColor: Colors.surface,
          borderTopColor: Colors.border,
          paddingBottom: 4,
          height: 56,
        },
        tabBarLabelStyle: {
          fontSize: FontSize.xs,
          fontWeight: '500',
        },
      }}
    >
      <Tabs.Screen
        name="dashboard"
        options={{
          title: 'Dashboard',
          tabBarIcon: ({ color }) => <Text style={{ fontSize: 20, color }}>📊</Text>,
        }}
      />
      <Tabs.Screen
        name="attendance"
        options={{
          title: 'Attendance',
          headerShown: false,
          tabBarIcon: ({ color }) => <Text style={{ fontSize: 20, color }}>📸</Text>,
        }}
      />
      <Tabs.Screen
        name="finance"
        options={{
          title: 'Finance',
          headerShown: false,
          tabBarIcon: ({ color }) => <Text style={{ fontSize: 20, color }}>💰</Text>,
        }}
      />
      <Tabs.Screen
        name="students"
        options={{
          title: 'Students',
          headerShown: false,
          tabBarIcon: ({ color }) => <Text style={{ fontSize: 20, color }}>🎓</Text>,
        }}
      />
      <Tabs.Screen
        name="inbox"
        options={{
          title: 'Inbox',
          tabBarIcon: ({ color }) => <Text style={{ fontSize: 20, color }}>🔔</Text>,
        }}
      />
      {/* Hidden screens — accessed via "More" or deep navigation */}
      <Tabs.Screen name="notifications" options={{ href: null, headerShown: false }} />
      <Tabs.Screen name="hr" options={{ href: null, headerShown: false }} />
      <Tabs.Screen name="hostel" options={{ href: null, headerShown: false }} />
      <Tabs.Screen name="transport" options={{ href: null, headerShown: false }} />
      <Tabs.Screen name="library" options={{ href: null, headerShown: false }} />
      <Tabs.Screen name="timetable" options={{ href: null }} />
      <Tabs.Screen name="results" options={{ href: null }} />
      <Tabs.Screen name="ai-assistant" options={{ href: null }} />
      <Tabs.Screen name="face-attendance" options={{ href: null, headerShown: false }} />
    </Tabs>
  );
}
