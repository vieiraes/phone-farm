// Tamanhos em CSS px (viewport do navegador), não em pixels físicos.
// status/nav = altura das barras do sistema; o app ocupa o que sobra entre elas.
// Nos aparelhos mais novos os números são aproximados: resolução física ÷ DPR de fábrica.
// frame = cor da moldura (acabamento do aparelho).

// iOS 26 congelou a versão do sistema no UA em 18_6; a versão real só aparece em Version/.
const iosUA = (os, safari) =>
  `Mozilla/5.0 (iPhone; CPU iPhone OS ${os} like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/${safari} Mobile/15E148 Safari/604.1`;
const androidUA = (model, android) =>
  `Mozilla/5.0 (Linux; Android ${android}; ${model}) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${process.versions.chrome} Mobile Safari/537.36`;

const ios = (props, os, safari) => ({ platform: 'ios', ua: iosUA(os, safari), ...props });
const android = (props) => ({ platform: 'android', status: 28, nav: 48, ...props, ua: androidUA(props.model, props.android) });

// A ordem aqui é a ordem do seletor, agrupada por brand.
const DEVICES = {
  // Apple
  'iphone-17-pro-max': ios({ name: 'iPhone 17 Pro Max', brand: 'Apple', w: 440, h: 956, dpr: 3, status: 62, nav: 34, radius: 62, cutout: 'island', frame: '#d9772e' }, '18_6', '26.0'),
  'iphone-17-pro': ios({ name: 'iPhone 17 Pro', brand: 'Apple', w: 402, h: 874, dpr: 3, status: 62, nav: 34, radius: 62, cutout: 'island', frame: '#2d3f5c' }, '18_6', '26.0'),
  'iphone-17': ios({ name: 'iPhone 17', brand: 'Apple', w: 402, h: 874, dpr: 3, status: 62, nav: 34, radius: 62, cutout: 'island', frame: '#9aa7c7' }, '18_6', '26.0'),
  'iphone-air': ios({ name: 'iPhone Air', brand: 'Apple', w: 420, h: 912, dpr: 3, status: 62, nav: 34, radius: 62, cutout: 'island', frame: '#d8d4cb' }, '18_6', '26.0'),
  'iphone-16e': ios({ name: 'iPhone 16e', brand: 'Apple', w: 390, h: 844, dpr: 3, status: 47, nav: 34, radius: 47, cutout: 'notch', frame: '#3a3a3c' }, '18_6', '26.0'),
  'iphone-15': ios({ name: 'iPhone 15', brand: 'Apple', w: 393, h: 852, dpr: 3, status: 54, nav: 34, radius: 55, cutout: 'island', frame: '#e8c8cf' }, '17_5', '17.5'),
  'iphone-se': ios({ name: 'iPhone SE', brand: 'Apple', w: 375, h: 667, dpr: 2, status: 20, nav: 0, radius: 0, cutout: 'none', homeButton: true, frame: '#1c1c1e' }, '17_5', '17.5'),
  // Samsung
  'galaxy-s25-ultra': android({ name: 'Galaxy S25 Ultra', brand: 'Samsung', w: 384, h: 832, dpr: 2.8125, radius: 18, cutout: 'punch', model: 'SM-S938B', android: '15', frame: '#5c6670' }),
  'galaxy-s25': android({ name: 'Galaxy S25', brand: 'Samsung', w: 360, h: 780, dpr: 3, radius: 36, cutout: 'punch', model: 'SM-S931B', android: '15', frame: '#3d4a63' }),
  'galaxy-s23': android({ name: 'Galaxy S23', brand: 'Samsung', w: 360, h: 780, dpr: 3, radius: 36, cutout: 'punch', model: 'SM-S911B', android: '14', frame: '#2b2e35' }),
  'galaxy-a56': android({ name: 'Galaxy A56', brand: 'Samsung', w: 384, h: 832, dpr: 2.8125, radius: 32, cutout: 'punch', model: 'SM-A566B', android: '15', frame: '#9a9fa8' }),
  'galaxy-a14': android({ name: 'Galaxy A14', brand: 'Samsung', w: 384, h: 856, dpr: 2.8125, radius: 30, cutout: 'drop', model: 'SM-A145M', android: '14', frame: '#2b2e35' }),
  // Google
  'pixel-10': android({ name: 'Pixel 10', brand: 'Google', w: 412, h: 923, dpr: 2.625, radius: 44, cutout: 'punch', model: 'Pixel 10', android: '16', frame: '#4b5f8a' }),
  'pixel-8': android({ name: 'Pixel 8', brand: 'Google', w: 412, h: 915, dpr: 2.625, radius: 40, cutout: 'punch', model: 'Pixel 8', android: '14', frame: '#2b2e35' }),
  // Xiaomi
  'xiaomi-15': android({ name: 'Xiaomi 15', brand: 'Xiaomi', w: 400, h: 890, dpr: 3, radius: 40, cutout: 'punch', model: 'Xiaomi 15', android: '15', frame: '#5a7d6a' }),
  'redmi-note-14-pro': android({ name: 'Redmi Note 14 Pro', brand: 'Xiaomi', w: 407, h: 904, dpr: 3, radius: 40, cutout: 'punch', model: 'Redmi Note 14 Pro 5G', android: '15', frame: '#6b5a8c' }),
  'redmi-note-14': android({ name: 'Redmi Note 14', brand: 'Xiaomi', w: 393, h: 873, dpr: 2.75, radius: 34, cutout: 'punch', model: 'Redmi Note 14', android: '14', frame: '#2b2e35' }),
  // Poco
  'poco-f7': android({ name: 'POCO F7', brand: 'Poco', w: 427, h: 924, dpr: 3, radius: 40, cutout: 'punch', model: 'POCO F7', android: '15', frame: '#b8bcc4' }),
  'poco-x7-pro': android({ name: 'POCO X7 Pro', brand: 'Poco', w: 407, h: 904, dpr: 3, radius: 40, cutout: 'punch', model: 'POCO X7 Pro', android: '15', frame: '#c9a227' }),
};

module.exports = { DEVICES };
