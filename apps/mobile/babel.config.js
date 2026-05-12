// Babel config cho Expo SDK 54.
//
// react-native-worklets/plugin BẮT BUỘC ở cuối plugins array — required cho
// Reanimated 4 + Gesture Handler 2 (expo-router 6 + nhiều lib khác đều dùng
// worklet internally). Thiếu plugin này, app crash ngay khi mount với
// "Reanimated 2 failed to create a worklet" hoặc tab Học không hiện.
//
// Version pairing cho Expo SDK 54 (Expo Go bake worklets 0.5.1 vào native):
//   react-native-reanimated@~4.1.0  +  react-native-worklets@0.5.1
// KHÔNG dùng Reanimated 4.0 (wants worklets 0.4) hoặc 4.3 (wants 0.8) —
// đều mismatch với Expo Go SDK 54 native.
module.exports = function (api) {
  api.cache(true);
  return {
    presets: ['babel-preset-expo'],
    plugins: ['react-native-worklets/plugin'],
  };
};
