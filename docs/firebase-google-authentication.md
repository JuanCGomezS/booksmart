# Configuración: acceso con Google

La aplicación usa Firebase Authentication directamente desde el navegador; no necesita Functions ni un backend propio.

## Activar el proveedor

1. Abre **Firebase Console → Authentication → Sign-in method**.
2. Selecciona **Google**, actívalo y define el correo de soporte del proyecto.
3. Guarda los cambios.

## Autorizar GitHub Pages

En **Authentication → Settings → Authorized domains**, agrega el dominio que sirve la aplicación:

- Para GitHub Pages: `TU-USUARIO.github.io`.
- Si se usa un dominio propio, agrega también ese dominio.

No incluyas `https://` ni la ruta del repositorio. Después del despliegue, prueba tanto el acceso como el registro desde `/login`.

## Comportamiento de las cuentas

- Una cuenta nueva creada con Google recibe el rol `customer` y conserva el consentimiento legal requerido.
- Las cuentas de administración y personal mantienen sus roles actuales.
- Si un correo ya tiene una cuenta con contraseña, se debe entrar con contraseña; Firebase evita crear una cuenta de Google paralela con ese correo.
