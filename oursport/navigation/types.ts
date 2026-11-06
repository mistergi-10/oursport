export type RootStackParamList = {
  Welcome: undefined;
  Login: { successMessage?: string } | undefined;
  Signup: undefined;
  ForgotPassword: undefined;
  ResetPassword: { email: string; devCode?: string };
  Main: { screen?: keyof MainTabParamList } | undefined;
  Conversation: { conversationId: string; name: string; userId?: string; isGroup?: boolean };
  CreateEvent: undefined;
  EventDetail: { eventId: string };
  Privacy: undefined;
  Report: { userId: string; name: string };
};
export type MainTabParamList = {
  Matching: undefined;
  Chats: undefined;
  Events: undefined;
  Profile: undefined;
};
