const DEFAULT_DB_URL = 'https://focuspulse-dd0f9-default-rtdb.firebaseio.com';
const DEFAULT_API_KEY = 'AIzaSyBGSGy0jdUBmNcjokNOa3UpcEkK_qU-6rQ';
AppSettingsPage({
  build(props) {
    const storage = props.settingsStorage;
    function cleanValue(key) {
      const raw = storage.getItem(key);
      if (raw === null || raw === undefined || raw === '') return '';
      if (typeof raw === 'object' && raw !== null) {
        const inner = raw.value !== undefined ? raw.value : raw.name;
        if (inner !== undefined) return key === 'password' ? String(inner) : String(inner).trim();
        return '';
      }
      if (typeof raw === 'string') {
        try {
          const v = JSON.parse(raw);
          if (typeof v === 'string') return key === 'password' ? v : v.trim();
          if (typeof v === 'number') return String(v);
          if (typeof v === 'object' && v !== null) {
            const inner = v.value !== undefined ? v.value : v.name;
            if (inner !== undefined) return key === 'password' ? String(inner) : String(inner).trim();
            return '';
          }
        } catch (_e) {}
        return key === 'password' ? raw : raw.trim();
      }
      return '';
    }
    const currentUrl = cleanValue('databaseUrl');
    if (!currentUrl || !currentUrl.startsWith('https://')) storage.setItem('databaseUrl', DEFAULT_DB_URL);
    const currentKey = cleanValue('apiKey');
    if (!currentKey || currentKey === '[object Object]') storage.setItem('apiKey', DEFAULT_API_KEY);
    const fields = [
      ['email', 'Correo de FocusPulse'],
      ['password', 'Contraseña de FocusPulse'],
      ['databaseUrl', 'URL de Realtime Database'],
      ['apiKey', 'Firebase Web API key']
    ];
    return View({style:{padding:'20px',background:'#071311',color:'#f3faf7'}}, [
      Text({style:{fontSize:'26px',fontWeight:'bold'}}, 'FocusPulse'),
      Text({style:{margin:'16px 0',lineHeight:'24px'}},
        'Introduce el mismo correo y contraseña con los que iniciaste sesión en la app FocusPulse (la URL y API key ya están preconfiguradas).'),
      ...fields.map(([key,label]) => View({style:{marginBottom:'20px'}}, [
        TextInput({
          label,
          settingsKey: key,
          type: key === 'password' ? 'password' : 'text',
          value: cleanValue(key),
          placeholder: key === 'password' ? 'Introduce tu contraseña' : label,
          onChange: (value) => {
            const str = value && typeof value === 'object' && value.value !== undefined ? String(value.value) : String(value || '');
            storage.setItem(key, key === 'password' ? str : str.trim());
          }
        }),
      ])),
      Text({style:{fontSize:'14px',lineHeight:'22px'}},
        'La contraseña se guarda localmente en los ajustes de Zepp. Mantén Zepp activo durante la sesión.'),
      Button({label:'Olvidar conexión',style:{minHeight:'48px',marginTop:'20px'},onClick:() => {
        storage.removeItem('email');
        storage.removeItem('password');
        storage.setItem('databaseUrl', DEFAULT_DB_URL);
        storage.setItem('apiKey', DEFAULT_API_KEY);
      }}),
    ]);
  },
});
