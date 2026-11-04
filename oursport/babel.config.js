module.exports = function (api) {
  api.cache(true);
  return {
    // babel-preset-expo auto-adds the react-native-worklets/react-native-reanimated
    // plugin when the corresponding package is installed; no manual plugin entry needed.
    presets: ["babel-preset-expo"],
  };
};
