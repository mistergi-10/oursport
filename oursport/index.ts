// Must be the very first import so the gesture handler native module
// initializes before any other module touches it (react-native-gesture-handler docs).
import 'react-native-gesture-handler';
import { registerRootComponent } from 'expo';

import App from './App';

registerRootComponent(App);
