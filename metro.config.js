// Expo'nun varsayılan Metro ayarları + SQLite veritabanını varlık olarak paketleme.
// assets/veri/istanbul-poi.db dosyası bu satır olmadan pakete girmez.
const { getDefaultConfig } = require('expo/metro-config');

const config = getDefaultConfig(__dirname);
config.resolver.assetExts.push('db');

module.exports = config;
