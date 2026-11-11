import Comercio from './Comercio';
import { Wallet } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import {
  AlertCircle, ArrowRight, BadgeCheck, Boxes, CalendarDays,
  Check, CheckCircle2, ChevronRight, Clock3, Eye, EyeOff,
  LayoutDashboard, LogOut, Menu, Package, PackagePlus, Pencil,
  Plus, RefreshCw, Search, ShieldCheck, ShoppingBag, SlidersHorizontal,
  Trash2, Users, X, Sun, Moon, ImagePlus, ImageOff, FolderPlus, Tag,
  UserRoundCheck, UserRoundX, KeyRound, UserRoundCog, ShieldAlert,
  type LucideIcon,
} from 'lucide-react';

type Rol = 'Administrador' | 'Cajero' | 'Sin rol';
type Usuario = { id: number; usuario: string; nombre: string; foto: string | null; rol: Rol; activo: boolean; protegido?: boolean; es_actual?: boolean; ultimo_acceso: string | null; creado_el: string | null };
type Producto = { activo: boolean; id: number; codigo: string; nombre: string; precio: number; stock: number; vencimiento: string | null; categoria_id: number | null; categoria: string | null; imagen: string | null };
type Categoria = { id: number; nombre: string; productos: number };
type Resumen = { dias_alerta: number; productos: number; unidades: number; stock_bajo: number; por_vencer: number; vencidos: number };
type EstadoInicio = { caja: {id:number; saldo_esperado:number; total_ventas:number} | null; ventas_hoy:number; total_hoy:number }; 
type Pagina = 'inicio' | 'ventas' | 'productos' | 'equipo';
type Filtro = 'todos' | 'reponer' | 'vencimiento';
type ProductoForm = { codigo: string; nombre: string; precio: string; stock: string; vencimiento: string; categoria_id: string; imagenArchivo: File | null; quitar_imagen: boolean };
type UsuarioForm = { nombre: string; usuario: string; rol: 'Administrador' | 'Cajero'; activo: boolean; clave: string; fotoArchivo: File | null; quitar_foto: boolean };
type Aviso = { texto: string; tipo: 'bien' | 'mal' } | null;
type EquipoFiltro = 'todos' | 'activos' | 'inactivos' | 'administradores' | 'cajeros';

class ApiError extends Error { constructor(message: string, public status: number) { super(message); } }
async function api<T>(ruta: string, opciones: RequestInit = {}): Promise<T> {
  const metodo = (opciones.method || 'GET').toUpperCase();
  const encabezados: Record<string, string> = opciones.body instanceof FormData ? {} : { 'Content-Type': 'application/json' };
  if (!['GET', 'HEAD', 'OPTIONS'].includes(metodo)) {
    let csr: Response;
    try { csr = await fetch('/api/csrf/', { credentials: 'same-origin' }); }
    catch { throw new ApiError('No se pudo conectar. Comprueba que Django esté funcionando.', 0); }
    if (!csr.ok) throw new ApiError('No se pudo preparar la solicitud.', csr.status);
    encabezados['X-CSRFToken'] = ((await csr.json()) as { csrfToken: string }).csrfToken;
  }
  let response: Response;
  try { response = await fetch(ruta, { ...opciones, credentials: 'same-origin', headers: { ...encabezados, ...opciones.headers } }); }
  catch { throw new ApiError('Sin conexión con el servidor. Revisa la terminal de Django.', 0); }
  let data: Record<string, unknown>;
  try { data = (await response.json()) as Record<string, unknown>; }
  catch { throw new ApiError('El servidor devolvió una respuesta inesperada.', response.status); }
  if (!response.ok) throw new ApiError(String(data.error || 'No fue posible completar esta acción.'), response.status);
  return data as T;
}
const peso = (x: number) => new Intl.NumberFormat('es-CL', { style: 'currency', currency: 'CLP', maximumFractionDigits: 0 }).format(x);
const n = (x: number) => new Intl.NumberFormat('es-CL').format(x);
const first = (s: string) => s.trim().split(/\s+/)[0] || 'hola';
const initials = (s: string) => s.trim().split(/\s+/).slice(0, 2).map(t => t.charAt(0).toUpperCase()).join('') || 'U';
const fechaHora = (valor: string | null) => valor ? new Date(valor).toLocaleString('es-CL', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : 'Aún no ingresa';
const fechaCorta = (valor: string | null) => valor ? new Date(valor).toLocaleDateString('es-CL', { day: '2-digit', month: 'long', year: 'numeric' }) : 'Sin registro';
function dias(fecha: string | null) {
  if (!fecha) return null;
  const [y, m, d] = fecha.split('-').map(Number);
  const hoy = new Date();
  return Math.round((Date.UTC(y, m - 1, d) - Date.UTC(hoy.getFullYear(), hoy.getMonth(), hoy.getDate())) / 86400000);
}
function textoFecha(fecha: string | null) {
  if (!fecha) return 'No aplica';
  const [y, m, d] = fecha.split('-');
  return `${d}/${m}/${y}`;
}
function tipoStock(p: Producto) {
  if (!p.stock) return { texto: 'Agotado', clase: 'critico' };
  if (p.stock < 5) return { texto: 'Quedan pocas', clase: 'alerta' };
  return { texto: 'Disponible', clase: 'normal' };
}
function tipoFecha(p: Producto, limite = 7) {
  const delta = dias(p.vencimiento);
  if (delta === null) return null;
  if (delta < 0) return { texto: 'Vencido', clase: 'critico' };
  if (delta === 0) return { texto: 'Vence hoy', clase: 'critico' };
  if (delta <= limite) return { texto: `Vence en ${delta} día${delta === 1 ? '' : 's'}`, clase: 'alerta' };
  return null;
}
const requiereAtencion = (p: Producto, limite = 7) => p.stock < 5 || (dias(p.vencimiento) !== null && dias(p.vencimiento)! <= limite);

function App() {
  const [usuario, setUsuario] = useState<Usuario | null>(null);
  const [validando, setValidando] = useState(true);
  const [errorLogin, setErrorLogin] = useState('');
  const [pagina, setPagina] = useState<Pagina>('inicio');
  const [productos, setProductos] = useState<Producto[]>([]);
  const [categorias, setCategorias] = useState<Categoria[]>([]);
  const [categoriaSeleccionada, setCategoriaSeleccionada] = useState('todas');
  const [gestionarCategorias, setGestionarCategorias] = useState(false);
  const [tema, setTema] = useState<'claro' | 'oscuro'>(() => {
    try { return localStorage.getItem('nexo-tema') === 'oscuro' ? 'oscuro' : 'claro'; }
    catch { return 'claro'; }
  });
  useEffect(() => {
    document.documentElement.dataset.theme = tema;
    try { localStorage.setItem('nexo-tema', tema); } catch { /* Navegador sin almacenamiento */ }
  }, [tema]);
  const [resumen, setResumen] = useState<Resumen | null>(null);
  const [estadoInicio, setEstadoInicio] = useState<EstadoInicio | null>(null);
  const [equipo, setEquipo] = useState<Usuario[]>([]);
  const [actualizando, setActualizando] = useState(false);
  const [aviso, setAviso] = useState<Aviso>(null);
  const [menu, setMenu] = useState(false);
  const [busqueda, setBusqueda] = useState('');
  const [filtro, setFiltro] = useState<Filtro>('todos');
  const [editarProducto, setEditarProducto] = useState<Producto | 'nuevo' | null>(null);
  const [borrarProducto, setBorrarProducto] = useState<Producto | null>(null);
  const [archivados, setArchivados] = useState<Producto[]>([]);
  const [mostrarArchivados, setMostrarArchivados] = useState(false);
  const [editarUsuario, setEditarUsuario] = useState<Usuario | 'nuevo' | null>(null);
  const [editarFotoPropia, setEditarFotoPropia] = useState(false);
  const [verUsuario, setVerUsuario] = useState<Usuario | null>(null);
  const [cambiarEstado, setCambiarEstado] = useState<Usuario | null>(null);
  const [cambiarClave, setCambiarClave] = useState<Usuario | null>(null);
  const [buscarEquipo, setBuscarEquipo] = useState('');
  const [filtroEquipo, setFiltroEquipo] = useState<EquipoFiltro>('todos');
  const admin = usuario?.rol === 'Administrador';

  const cargarDatos = useCallback(async (rol: Rol) => {
    const [p, r, c, u, e] = await Promise.all([
      api<{ productos: Producto[] }>('/api/productos/'),
      api<Resumen>('/api/resumen/'),
      api<{ categorias: Categoria[] }>('/api/categorias/'),
      rol === 'Administrador' ? api<{ usuarios: Usuario[] }>('/api/usuarios/') : Promise.resolve({ usuarios: [] }),
      api<EstadoInicio>('/api/comercio/estado/'),
    ]);
    setProductos(p.productos); setResumen(r); setCategorias(c.categorias); setEquipo(u.usuarios); setEstadoInicio(e);
  }, []);

  useEffect(() => {
    let vivo = true;
    api<{ usuario: Usuario }>('/api/session/').then(async data => {
      if (!vivo) return;
      setUsuario(data.usuario);
      try { await cargarDatos(data.usuario.rol); }
      catch (err) { if (vivo) setAviso({ texto: (err as Error).message, tipo: 'mal' }); }
    }).catch(err => {
      if (vivo && (!(err instanceof ApiError) || err.status !== 401)) setErrorLogin((err as Error).message);
    }).finally(() => { if (vivo) setValidando(false); });
    return () => { vivo = false; };
  }, [cargarDatos]);

  async function entrar(nombre: string, clave: string) {
    setErrorLogin('');
    try {
      const datos = await api<{ usuario: Usuario }>('/api/login/', { method: 'POST', body: JSON.stringify({ usuario: nombre, clave }) });
      setUsuario(datos.usuario); setPagina('inicio'); setAviso(null);
      try { await cargarDatos(datos.usuario.rol); }
      catch (err) { setAviso({ texto: (err as Error).message, tipo: 'mal' }); }
    } catch (err) { setErrorLogin((err as Error).message); }
  }
  async function salir() {
    try {
      await api('/api/logout/', { method: 'POST' });
      setUsuario(null); setProductos([]); setCategorias([]); setResumen(null); setEquipo([]); setEstadoInicio(null);
      setPagina('inicio'); setAviso(null); setErrorLogin(''); setMenu(false);
    } catch (err) { setAviso({ texto: (err as Error).message, tipo: 'mal' }); }
  }
  async function actualizar() {
    if (!usuario || actualizando) return;
    setActualizando(true);
    try { await cargarDatos(usuario.rol); const sesion = await api<{ usuario: Usuario }>('/api/session/'); setUsuario(sesion.usuario); setAviso(null); }
    catch (err) {
      if (err instanceof ApiError && err.status === 401) { setUsuario(null); setErrorLogin('Tu sesión terminó. Ingresa nuevamente.'); }
      else setAviso({ texto: (err as Error).message, tipo: 'mal' });
    } finally { setActualizando(false); }
  }
  const navegar = (destino: Pagina, filtrar: Filtro = 'todos') => {
    setPagina(destino); setMenu(false); setAviso(null);
    if (destino === 'productos') { setFiltro(filtrar); setBusqueda(''); setCategoriaSeleccionada('todas'); }
  };
  async function guardarProducto(form: ProductoForm) {
    if (!usuario || !admin || !editarProducto) return;
    const nuevo = editarProducto === 'nuevo';
    const precio = Number(form.precio), stock = Number(form.stock);
    if (!Number.isSafeInteger(precio) || precio < 0 || !Number.isSafeInteger(stock) || stock < 0) throw Error('El precio y la cantidad deben ser números enteros, desde cero.');
    const cuerpo = new FormData();
    cuerpo.append('codigo', form.codigo.trim());
    cuerpo.append('nombre', form.nombre.trim());
    cuerpo.append('precio', String(precio));
    cuerpo.append('stock', String(stock));
    cuerpo.append('vencimiento', form.vencimiento);
    cuerpo.append('categoria_id', form.categoria_id);
    if (form.imagenArchivo) cuerpo.append('imagen', form.imagenArchivo);
    if (form.quitar_imagen) cuerpo.append('quitar_imagen', 'true');
    await api(nuevo ? '/api/productos/' : `/api/productos/${(editarProducto as Producto).id}/`, {
      method: 'POST', body: cuerpo,
    });
    setEditarProducto(null); setAviso({ tipo: 'bien', texto: nuevo ? 'Producto añadido al catálogo.' : 'Cambios guardados.' });
    try { await cargarDatos(usuario.rol); } catch { setAviso({ tipo: 'mal', texto: 'Guardado. No se pudo actualizar la lista; pulsa Actualizar.' }); }
  }
  async function guardarCategoria(nombre: string, categoria: Categoria | null) {
    if (!usuario || !admin) return;
    await api(categoria ? `/api/categorias/${categoria.id}/` : '/api/categorias/', {
      method: categoria ? 'PUT' : 'POST', body: JSON.stringify({ nombre }),
    });
    await cargarDatos(usuario.rol);
    setAviso({ tipo: 'bien', texto: categoria ? 'Tipo de producto actualizado.' : 'Tipo de producto creado.' });
  }
  async function borrarCategoria(categoria: Categoria) {
    if (!usuario || !admin) return;
    await api(`/api/categorias/${categoria.id}/`, { method: 'DELETE' });
    if (categoriaSeleccionada === String(categoria.id)) setCategoriaSeleccionada('todas');
    await cargarDatos(usuario.rol);
    setAviso({ tipo: 'bien', texto: 'Tipo de producto eliminado.' });
  }
  async function eliminarProducto() {
    if (!usuario || !borrarProducto || !admin) return;
    await api(`/api/productos/${borrarProducto.id}/`, { method: 'DELETE' });
    setBorrarProducto(null);
    setAviso({ tipo: 'bien', texto: 'Producto retirado del catálogo. Sus ventas anteriores se conservaron.' });
    try { await cargarDatos(usuario.rol); }
    catch { setAviso({ tipo: 'mal', texto: 'El producto fue retirado. Pulsa Actualizar si la lista no cambia.' }); }
  }
  async function alternarArchivados() {
    if (!admin) return;
    if (!mostrarArchivados) {
      try {
        const datos = await api<{ productos: Producto[] }>('/api/productos/?archivados=1');
        setArchivados(datos.productos);
        setMostrarArchivados(true);
      } catch (err) { setAviso({ tipo: 'mal', texto: (err as Error).message }); return; }
    } else setMostrarArchivados(false);
    setCategoriaSeleccionada('todas'); setFiltro('todos'); setBusqueda('');
  }
  async function restaurarProducto(p: Producto) {
    if (!usuario || !admin) return;
    await api(`/api/productos/${p.id}/`, { method: 'PUT', body: JSON.stringify({ restaurar: true }) });
    const datos = await api<{ productos: Producto[] }>('/api/productos/?archivados=1');
    setArchivados(datos.productos);
    await cargarDatos(usuario.rol);
    setAviso({ tipo: 'bien', texto: `${p.nombre} volvió al catálogo.` });
  }
  async function guardarUsuario(form: UsuarioForm) {
    if (!usuario || !admin || !editarUsuario) return;
    const nuevo = editarUsuario === 'nuevo';
    const cuerpo = new FormData();
    cuerpo.append('nombre', form.nombre.trim());
    cuerpo.append('usuario', form.usuario.trim());
    cuerpo.append('rol', form.rol);
    cuerpo.append('activo', String(form.activo));
    cuerpo.append('clave', form.clave);
    if (form.fotoArchivo) cuerpo.append('foto', form.fotoArchivo);
    if (form.quitar_foto) cuerpo.append('quitar_foto', 'true');
    const respuesta = await api<{ usuario: Usuario }>(nuevo ? '/api/usuarios/' : `/api/usuarios/${(editarUsuario as Usuario).id}/`, {
      method: 'POST', body: cuerpo,
    });
    if (respuesta.usuario.id === usuario.id) setUsuario(respuesta.usuario);
    setEditarUsuario(null); setAviso({ tipo: 'bien', texto: nuevo ? 'Cuenta creada. Comparte las credenciales en privado con la persona.' : 'Datos de la cuenta guardados.' });
    try { await cargarDatos(usuario.rol); } catch { setAviso({ tipo: 'mal', texto: 'Guardado. Pulsa Actualizar para ver los cambios.' }); }
  }


  async function guardarFotoPropia(archivo: File | null, quitar: boolean) {
    const cuerpo = new FormData();
    if (archivo) cuerpo.append('foto', archivo);
    if (quitar) cuerpo.append('quitar_foto', 'true');
    const respuesta = await api<{ usuario: Usuario }>('/api/mi-foto/', { method: 'POST', body: cuerpo });
    setUsuario(respuesta.usuario);
    setEquipo(prev => prev.map(u => u.id === respuesta.usuario.id ? respuesta.usuario : u));
    setEditarFotoPropia(false);
    setAviso({ tipo: 'bien', texto: quitar ? 'Foto de tu cuenta eliminada.' : 'Tu foto de perfil se ha actualizado.' });
  }

  async function guardarEstado(u: Usuario) {
    if (!admin || u.es_actual || u.protegido) throw Error('Esta cuenta no permite cambiar su estado.');
    await api(`/api/usuarios/${u.id}/estado/`, { method: 'POST', body: JSON.stringify({ activo: !u.activo }) });
    setCambiarEstado(null);
    setAviso({ tipo: 'bien', texto: u.activo ? 'Acceso suspendido. La cuenta y sus datos se conservaron.' : 'Acceso reactivado. La persona puede volver a ingresar.' });
    if (usuario) await cargarDatos(usuario.rol);
  }
  async function guardarNuevaClave(u: Usuario, clave: string, actual: string) {
    await api(`/api/usuarios/${u.id}/clave/`, { method: 'POST', body: JSON.stringify({ clave, ...(u.es_actual ? { clave_actual: actual } : {}) }) });
    setCambiarClave(null);
    setAviso({ tipo: 'bien', texto: 'Contraseña cambiada. Comparte la nueva clave de forma privada si es para otra persona.' });
  }
  const usuariosFiltrados = useMemo(() => equipo.filter(u => {
    const q = buscarEquipo.toLocaleLowerCase('es').trim();
    if (q && !`${u.nombre} ${u.usuario} ${u.rol}`.toLocaleLowerCase('es').includes(q)) return false;
    if (filtroEquipo === 'activos') return u.activo;
    if (filtroEquipo === 'inactivos') return !u.activo;
    if (filtroEquipo === 'administradores') return u.rol === 'Administrador';
    if (filtroEquipo === 'cajeros') return u.rol === 'Cajero';
    return true;
  }), [equipo, buscarEquipo, filtroEquipo]);

  const alertas = useMemo(() => productos.filter(p => requiereAtencion(p, resumen?.dias_alerta || 7)).sort((a, b) => {
    const prioridad = (p: Producto) => p.stock === 0 ? 0 : (dias(p.vencimiento) ?? 99999) < 0 ? 1 : p.stock < 5 ? 2 : 3;
    return prioridad(a) - prioridad(b) || a.nombre.localeCompare(b.nombre, 'es');
  }), [productos, resumen?.dias_alerta]);
  const catalogoVisible = mostrarArchivados ? archivados : productos;
  const lista = useMemo(() => catalogoVisible.filter(p => {
    if (!`${p.nombre} ${p.codigo} ${p.categoria || ''}`.toLocaleLowerCase('es').includes(busqueda.toLocaleLowerCase('es').trim())) return false;
    if (categoriaSeleccionada === 'sin' && p.categoria_id !== null) return false;
    if (categoriaSeleccionada !== 'sin' && categoriaSeleccionada !== 'todas' && p.categoria_id !== Number(categoriaSeleccionada)) return false;
    if (filtro === 'reponer') return p.stock < 5;
    if (filtro === 'vencimiento') return (dias(p.vencimiento) ?? 99999) <= (resumen?.dias_alerta || 7);
    return true;
  }), [catalogoVisible, busqueda, filtro, categoriaSeleccionada, resumen?.dias_alerta]);
  const vencimientoTotal = (resumen?.por_vencer || 0) + (resumen?.vencidos || 0);

  if (validando) return <div className="cargando-pagina"><div className="logo-icon"><ShoppingBag size={25}/></div><span className="spinner"/>Cargando tu tienda…</div>;
  if (!usuario) return <><Login onLogin={entrar} error={errorLogin}/><button className="theme-toggle login-theme" type="button" aria-label={tema === 'claro' ? 'Activar modo oscuro' : 'Activar modo claro'} title={tema === 'claro' ? 'Modo oscuro' : 'Modo claro'} onClick={() => setTema(tema === 'claro' ? 'oscuro' : 'claro')}>{tema === 'claro' ? <Moon size={19}/> : <Sun size={19}/>}</button></>;

  return <div className="shell">
    <aside className={`sidebar ${menu ? 'abierta' : ''}`}>
      <div className="sidebar-brand"><div className="logo-icon"><ShoppingBag size={24}/></div><div><strong>Merqia<span>.</span></strong><small>Tu tienda, más simple</small></div></div>
      <div className="sidebar-label">TU ESPACIO</div>
      <nav className="nav" aria-label="Menú principal">
        <Nav icon={LayoutDashboard} text="Inicio" active={pagina === 'inicio'} onClick={() => navegar('inicio')}/>
        <Nav icon={Wallet} text="Ventas y caja" active={pagina === 'ventas'} onClick={() => navegar('ventas')}/>
        <Nav icon={Package} text="Productos" active={pagina === 'productos'} onClick={() => navegar('productos')}/>
        {admin && <Nav icon={Users} text="Equipo" active={pagina === 'equipo'} onClick={() => navegar('equipo')}/>}
      </nav>
      <div className="sidebar-bottom"><div className="cuenta"><button type="button" className="avatar-button" title="Cambiar mi foto de perfil" aria-label="Cambiar mi foto de perfil" onClick={() => setEditarFotoPropia(true)}><FotoUsuario usuario={usuario}/><span className="avatar-edit-mark"><Pencil size={10}/></span></button><span><strong>{usuario.nombre}</strong><small>{usuario.rol}</small></span></div><button className="salir" type="button" onClick={salir}><LogOut size={18}/> Cerrar sesión</button></div>
    </aside>
    {menu && <button aria-label="Cerrar menú" className="mobile-backdrop" type="button" onClick={() => setMenu(false)}/>}
    <section className="main-area">
      <header className="topbar"><button className="mobile-menu icon-btn" type="button" aria-label="Abrir menú" onClick={() => setMenu(true)}><Menu size={22}/></button><div className="crumb"><span>Merqia</span><ChevronRight size={15}/><strong>{pagina === 'inicio' ? 'Inicio' : pagina === 'productos' ? 'Productos' : pagina === 'ventas' ? 'Ventas y caja' : 'Equipo'}</strong></div><div className="top-actions"><button type="button" className="theme-toggle" aria-label={tema === 'claro' ? 'Activar modo oscuro' : 'Activar modo claro'} title={tema === 'claro' ? 'Modo oscuro' : 'Modo claro'} onClick={() => setTema(tema === 'claro' ? 'oscuro' : 'claro')}>{tema === 'claro' ? <Moon size={19}/> : <Sun size={19}/>}</button><span className="today"><CalendarDays size={16}/>{new Date().toLocaleDateString('es-CL', { day: 'numeric', month: 'short', year: 'numeric' })}</span><button type="button" className="refresh" disabled={actualizando} onClick={actualizar}><RefreshCw size={16} className={actualizando ? 'spin' : ''}/><span>Actualizar</span></button></div></header>
      <main className="content">
        {aviso && <div className={`toast ${aviso.tipo === 'bien' ? 'success' : 'error'}`} role="status">{aviso.tipo === 'bien' ? <CheckCircle2 size={18}/> : <AlertCircle size={18}/>}<span>{aviso.texto}</span><button aria-label="Cerrar aviso" type="button" onClick={() => setAviso(null)}><X size={17}/></button></div>}
        {pagina === 'ventas' && <Comercio api={api} productos={productos} categorias={categorias} admin={admin} onRefresh={actualizar}/>}
        {pagina === 'inicio' && <>
          <div className="page-title"><div><span className="eyebrow">HOLA, {first(usuario.nombre).toLocaleUpperCase('es')}</span><h1>Tu tienda, al día<span className="accent">.</span></h1><p>Un vistazo a lo que importa hoy en tu negocio.</p></div></div>
          <div className="stat-grid">
            <Stat icon={Wallet} label="Ventas de hoy" value={estadoInicio ? peso(estadoInicio.total_hoy) : '—'} caption={`${estadoInicio?.ventas_hoy || 0} venta${estadoInicio?.ventas_hoy === 1 ? '' : 's'} registrada${estadoInicio?.ventas_hoy === 1 ? '' : 's'}`} tone="blue"/>
            <Stat icon={Boxes} label="Necesitan reposición" value={resumen ? n(resumen.stock_bajo) : '—'} caption="Menos de 5 unidades" tone="orange"/>
            <Stat icon={Clock3} label="Revisar vencimientos" value={resumen ? n(vencimientoTotal) : '—'} caption="Incluye productos vencidos" tone="red"/>
          </div>
          <section className="spotlight spotlight-sales"><div className="spotlight-copy"><span className="mini-label"><CheckCircle2 size={15}/> OPERACIÓN DEL DÍA</span><h2>{estadoInicio?.caja ? 'Tu caja está lista para vender.' : 'Comienza tu día con todo en orden.'}</h2><p>{estadoInicio?.caja ? 'Tienes un turno abierto. Puedes seguir cobrando y consultar tus movimientos cuando los necesites.' : 'Abre tu caja con el dinero inicial y empieza a registrar tus ventas de forma sencilla.'}</p><button type="button" className="button primary contrast" onClick={() => navegar('ventas')}>{estadoInicio?.caja ? 'Continuar vendiendo' : 'Ir a abrir caja'} <ArrowRight size={18}/></button></div><div className="spotlight-visual"><div className="sales-balance-card"><span>{estadoInicio?.caja ? 'Efectivo esperado en caja' : 'Estado de caja'}</span><strong>{estadoInicio?.caja ? peso(estadoInicio.caja.saldo_esperado) : 'Cerrada'}</strong><small>{estadoInicio?.caja ? `Turno #${estadoInicio.caja.id} · ${n(estadoInicio.caja.total_ventas)} ventas` : 'Abre un turno para empezar'}</small></div></div></section>
          <section className="card attention-card"><div className="section-heading"><div><h2>Lo que necesita atención</h2><p>Los casos más urgentes, ordenados para facilitar tu revisión.</p></div></div>
            {alertas.length ? <div className="attention-list">{alertas.slice(0, 6).map(p => {
              const venc = tipoFecha(p, resumen?.dias_alerta || 7); const est = !p.stock ? { texto: 'Agotado', clase: 'critico' } : venc?.clase === 'critico' ? venc : p.stock < 5 ? { texto: 'Reponer', clase: 'alerta' } : venc || { texto: 'Revisar', clase: 'alerta' };
              return <button type="button" className="attention-row" key={p.id} onClick={() => { navegar('productos'); setBusqueda(p.nombre); }}><Miniatura producto={p} size="attention"/><span className="attention-name"><strong>{p.nombre}</strong><small>{p.stock} unidad{p.stock === 1 ? '' : 'es'} disponibles</small></span><span className={`pill ${est.clase}`}>{est.texto}</span><ChevronRight className="attention-arrow" size={18}/></button>;
            })}</div> : <div className="empty-inline"><BadgeCheck size={27}/><span>Todo en orden. Aquí verás los productos que necesiten atención.</span></div>}
          </section>
        </>}
        {pagina === 'productos' && <>
          <div className="page-title title-with-action"><div><span className="eyebrow">CONTROL DE PRODUCTOS</span><h1>{mostrarArchivados ? 'Productos archivados' : 'Tu inventario'}<span className="accent">.</span></h1><p>{mostrarArchivados ? 'Productos retirados que puedes recuperar cuando los necesites.' : 'Encuentra y actualiza tus productos sin complicaciones.'}</p></div>{admin && !mostrarArchivados && <button className="button primary" type="button" onClick={() => setEditarProducto('nuevo')}><Plus size={19}/> Agregar producto</button>}</div>
          <div className="category-bar" aria-label="Filtrar por tipo de producto">{!mostrarArchivados && <div className="category-scroll"><button type="button" className={`category-chip ${categoriaSeleccionada === 'todas' ? 'active' : ''}`} onClick={() => setCategoriaSeleccionada('todas')}>Todos <span>{productos.length}</span></button>{categorias.map(c => <button key={c.id} type="button" className={`category-chip ${categoriaSeleccionada === String(c.id) ? 'active' : ''}`} onClick={() => setCategoriaSeleccionada(String(c.id))}>{c.nombre}<span>{productos.filter(p => p.categoria_id === c.id).length}</span></button>)}{productos.some(p => p.categoria_id === null) && <button type="button" className={`category-chip ${categoriaSeleccionada === 'sin' ? 'active' : ''}`} onClick={() => setCategoriaSeleccionada('sin')}>Sin categoría <span>{productos.filter(p => p.categoria_id === null).length}</span></button>}</div>}{admin && !mostrarArchivados && <button type="button" className="category-manage" onClick={() => setGestionarCategorias(true)}><FolderPlus size={17}/> Organizar tipos</button>}{admin && <button type="button" className="category-manage" onClick={alternarArchivados}><Package size={17}/>{mostrarArchivados ? 'Volver al catálogo' : 'Ver archivados'}</button>}</div>
          <section className="card table-card"><div className="table-toolbar"><label className="searchbox"><Search size={20}/><input aria-label="Buscar productos" placeholder="Buscar producto, código o tipo" value={busqueda} onChange={e => setBusqueda(e.target.value)}/>{busqueda && <button type="button" aria-label="Borrar búsqueda" onClick={() => setBusqueda('')}><X size={16}/></button>}</label><div className="filter-wrap"><SlidersHorizontal size={17}/><label htmlFor="filtro-productos">Mostrar</label><select id="filtro-productos" value={filtro} onChange={e => setFiltro(e.target.value as Filtro)}><option value="todos">Todos los productos</option><option value="reponer">Necesitan reposición</option><option value="vencimiento">Revisar vencimientos</option></select></div></div>
            <div className="table-overflow"><table><thead><tr><th>Producto</th><th>Precio</th><th>Existencias</th><th>Vencimiento</th>{admin && <th className="right">Acciones</th>}</tr></thead><tbody>{lista.map(p => {
              const stock = tipoStock(p), venc = tipoFecha(p, resumen?.dias_alerta || 7);
              return <tr key={p.id}><td><div className="product-cell"><Miniatura producto={p}/><div><strong>{p.nombre}</strong><small>{p.categoria || 'Sin categoría'} · {p.codigo}</small></div></div></td><td className="price">{peso(p.precio)}</td><td><div className="stock-cell"><strong>{n(p.stock)} un.</strong><span className={`pill ${stock.clase}`}>{stock.texto}</span></div></td><td><div className="date-cell"><span>{textoFecha(p.vencimiento)}</span>{venc && <span className={`pill ${venc.clase}`}>{venc.texto}</span>}</div></td>{admin && <td className="right"><div className="row-actions">{mostrarArchivados ? <button type="button" className="edit-action" onClick={async () => { try { await restaurarProducto(p); } catch (err) { setAviso({ tipo: 'mal', texto: (err as Error).message }); } }}><RefreshCw size={16}/> Recuperar</button> : <><button type="button" className="edit-action" onClick={() => setEditarProducto(p)}><Pencil size={16}/> Editar</button><button type="button" className="icon-btn delete-action" aria-label={`Retirar ${p.nombre}`} title={`Retirar ${p.nombre}`} onClick={() => setBorrarProducto(p)}><Trash2 size={17}/></button></>}</div></td>}</tr>;
            })}</tbody></table></div>
            {!lista.length && <div className="empty"><Search size={33}/><h3>{mostrarArchivados ? 'No hay productos archivados' : !productos.length ? 'Tu catálogo está vacío' : 'No encontramos productos'}</h3><p>{mostrarArchivados ? 'Los productos que retires aparecerán aquí para recuperarlos.' : !productos.length ? 'Agrega tu primer producto para comenzar.' : 'Prueba con otro nombre o vuelve a mostrar todos.'}</p>{catalogoVisible.length > 0 && <button className="button secondary" type="button" onClick={() => { setFiltro('todos'); setBusqueda(''); setCategoriaSeleccionada('todas'); }}>Mostrar todos</button>}{!mostrarArchivados && !productos.length && admin && <button className="button primary" type="button" onClick={() => setEditarProducto('nuevo')}><Plus size={17}/> Agregar producto</button>}</div>}
            <div className="table-bottom"><span>{n(lista.length)} de {n(catalogoVisible.length)} productos</span><span>Precios en pesos chilenos</span></div>
          </section>
        </>}
        {pagina === 'equipo' && admin && <>
          <div className="page-title title-with-action"><div><span className="eyebrow">PERSONAL Y PERMISOS</span><h1>Tu equipo<span className="accent">.</span></h1><p>Todos los accesos a tu tienda, en un solo lugar.</p></div><button className="button primary" type="button" onClick={() => setEditarUsuario('nuevo')}><Plus size={19}/> Agregar persona</button></div>
          <div className="team-overview" aria-label="Resumen de accesos">
            <div><span className="team-overview-icon"><Users size={20}/></span><span><strong>{n(equipo.length)}</strong><small>Cuentas registradas</small></span></div>
            <div><span className="team-overview-icon green"><UserRoundCheck size={20}/></span><span><strong>{n(equipo.filter(u => u.activo).length)}</strong><small>Con acceso</small></span></div>
            <div><span className="team-overview-icon gray"><UserRoundX size={20}/></span><span><strong>{n(equipo.filter(u => !u.activo).length)}</strong><small>Acceso suspendido</small></span></div>
          </div>
          <section className="card table-card"><div className="team-heading"><div><h2>Personas registradas</h2><p>Consulta quién puede entrar y administra sus permisos sin salir de Merqia.</p></div></div>
            <div className="team-toolbar"><label className="searchbox"><Search size={19}/><input aria-label="Buscar personas" placeholder="Buscar por nombre o usuario" value={buscarEquipo} onChange={e => setBuscarEquipo(e.target.value)}/>{buscarEquipo && <button type="button" aria-label="Borrar búsqueda" onClick={() => setBuscarEquipo('')}><X size={16}/></button>}</label><div className="filter-wrap"><SlidersHorizontal size={17}/><label htmlFor="filtro-equipo">Mostrar</label><select id="filtro-equipo" value={filtroEquipo} onChange={e => setFiltroEquipo(e.target.value as EquipoFiltro)}><option value="todos">Todas las cuentas</option><option value="activos">Con acceso</option><option value="inactivos">Sin acceso</option><option value="administradores">Administradores</option><option value="cajeros">Cajeros</option></select></div></div>
            <div className="table-overflow"><table className="team-table"><thead><tr><th>Persona</th><th>Permisos</th><th>Último acceso</th><th>Estado</th><th className="right">Administrar</th></tr></thead><tbody>{usuariosFiltrados.map(u => <tr key={u.id}><td><div className="person-cell"><FotoUsuario usuario={u} className="light"/><div><strong>{u.nombre}{u.es_actual ? ' (tú)' : ''}</strong><small>@{u.usuario}</small></div></div></td><td><span className={`pill ${u.rol === 'Administrador' ? 'admin-pill' : 'soft'}`}>{u.rol}</span></td><td className="team-last-login">{fechaHora(u.ultimo_acceso)}</td><td><span className={`pill ${u.activo ? 'normal' : 'muted'}`}>{u.activo ? 'Habilitada' : 'Suspendida'}</span></td><td className="right"><button type="button" className="edit-action" onClick={() => setVerUsuario(u)}>Ver cuenta <ChevronRight size={16}/></button></td></tr>)}</tbody></table></div>
            {!usuariosFiltrados.length && <div className="empty"><Search size={29}/><h3>No encontramos personas</h3><p>Prueba con otro nombre o revisa el filtro seleccionado.</p><button className="button secondary" type="button" onClick={() => {setBuscarEquipo(''); setFiltroEquipo('todos');}}>Ver todas las cuentas</button></div>}
            <div className="table-bottom"><span>{n(usuariosFiltrados.length)} de {n(equipo.length)} cuentas</span><span>Las contraseñas nunca se muestran.</span></div>
          </section>
          <div className="hint"><ShieldCheck size={18}/><span>Solo los administradores pueden gestionar el equipo. Las cuentas suspendidas se conservan y no pueden iniciar sesión.</span></div>
        </>}
      </main>
    </section>
    {editarFotoPropia && <ModalFotoPropia usuario={usuario} onClose={() => setEditarFotoPropia(false)} onSave={guardarFotoPropia}/>}
    {gestionarCategorias && <ModalCategorias categorias={categorias} onClose={() => setGestionarCategorias(false)} onSave={guardarCategoria} onDelete={borrarCategoria}/>}
    {editarProducto && <ModalProducto key={editarProducto === 'nuevo' ? 'nuevo' : editarProducto.id} valor={editarProducto} categorias={categorias} onClose={() => setEditarProducto(null)} onSave={guardarProducto}/>}
    {borrarProducto && <ConfirmarBorrado producto={borrarProducto} onClose={() => setBorrarProducto(null)} onConfirm={eliminarProducto}/>}
    {verUsuario && <FichaUsuario usuario={verUsuario} onClose={() => setVerUsuario(null)} onEdit={() => {setEditarUsuario(verUsuario); setVerUsuario(null);}} onPassword={() => {setCambiarClave(verUsuario); setVerUsuario(null);}} onEstado={() => {setCambiarEstado(verUsuario); setVerUsuario(null);}}/>}
    {cambiarEstado && <ConfirmarEstado usuario={cambiarEstado} onClose={() => setCambiarEstado(null)} onConfirm={() => guardarEstado(cambiarEstado)}/>}
    {cambiarClave && <ModalClave usuario={cambiarClave} onClose={() => setCambiarClave(null)} onSave={(clave, actual) => guardarNuevaClave(cambiarClave, clave, actual)}/>}
    {editarUsuario && <ModalUsuario key={editarUsuario === 'nuevo' ? 'nuevo' : editarUsuario.id} valor={editarUsuario} onClose={() => setEditarUsuario(null)} onSave={guardarUsuario}/>}
  </div>;
}

function FotoUsuario({ usuario, className = '' }: { usuario: Usuario; className?: string }) {
  return <span className={`avatar ${className}`}>{usuario.foto ? <img src={usuario.foto} alt={`Foto de ${usuario.nombre}`} loading="lazy"/> : initials(usuario.nombre)}</span>;
}
function Miniatura({ producto, size = 'tabla' }: { producto: Producto; size?: 'tabla' | 'attention' }) {
  return <span className={`product-symbol photo-${size}`}>{producto.imagen ? <img src={producto.imagen} alt={`Imagen de ${producto.nombre}`} loading="lazy"/> : <Package size={21}/>}</span>;
}
function Nav({ icon: Icon, text, active, onClick }: { icon: LucideIcon; text: string; active: boolean; onClick: () => void }) {
  return <button className={`nav-link ${active ? 'selected' : ''}`} type="button" aria-current={active ? 'page' : undefined} onClick={onClick}><Icon size={21}/><span>{text}</span>{active && <span className="nav-dot"/>}</button>;
}
function Stat({ icon: Icon, label, value, caption, tone }: { icon: LucideIcon; label: string; value: string; caption: string; tone: string }) {
  return <article className="stat"><div className="stat-top"><span>{label}</span><div className={`stat-icon ${tone}`}><Icon size={21}/></div></div><strong>{value}</strong><small>{caption}</small></article>;
}
function Login({ onLogin, error }: { onLogin: (nombre: string, clave: string) => Promise<void>; error: string }) {
  const [nombre, setNombre] = useState('');
  const [clave, setClave] = useState('');
  const [verClave, setVerClave] = useState(false);
  const [ocupado, setOcupado] = useState(false);
  async function enviar(e: FormEvent<HTMLFormElement>) {
    e.preventDefault(); if (ocupado) return;
    setOcupado(true); try { await onLogin(nombre.trim(), clave); } finally { setOcupado(false); }
  }
  return <div className="login-layout"><section className="login-story"><div className="login-brand"><div className="logo-icon"><ShoppingBag size={24}/></div><strong>Merqia<span>.</span></strong></div><div className="login-story-body"><span className="story-kicker"><span className="kicker-dot"/> HECHO PARA TU COMERCIO</span><h1>Tu negocio en orden.<br/><em>Tu día más fácil.</em></h1><p>Productos, existencias y equipo en un solo lugar. Todo claro, desde el primer momento.</p><div className="story-art" aria-hidden="true"><div className="art-base"><div className="art-label"><PackagePlus size={18}/> INVENTARIO ORGANIZADO</div><div className="art-shelves"><span/><span/><span/><span/><span/><span/></div><div className="art-badge"><Check size={18}/> Todo a mano</div></div></div></div><div className="story-footer">Merqia · Gestión sencilla para tu tienda</div></section><section className="login-form-area"><div className="login-box"><div className="login-mobile-logo"><div className="logo-icon"><ShoppingBag size={20}/></div><strong>Merqia<span>.</span></strong></div><span className="eyebrow">QUÉ BUENO VERTE</span><h2>Bienvenido a Merqia</h2><p>Ingresa a tu espacio de trabajo.</p><form onSubmit={enviar}><div className="field"><label htmlFor="login-user">Usuario</label><input id="login-user" autoComplete="username" placeholder="Tu nombre de usuario" value={nombre} onChange={e => setNombre(e.target.value)} maxLength={150} required autoFocus/></div><div className="field"><label htmlFor="login-pass">Contraseña</label><div className="password-field"><input id="login-pass" type={verClave ? 'text' : 'password'} autoComplete="current-password" placeholder="Escribe tu contraseña" value={clave} onChange={e => setClave(e.target.value)} required/><button type="button" title={verClave ? 'Ocultar contraseña' : 'Mostrar contraseña'} aria-label={verClave ? 'Ocultar contraseña' : 'Mostrar contraseña'} onClick={() => setVerClave(!verClave)}>{verClave ? <EyeOff size={19}/> : <Eye size={19}/>}</button></div></div>{error && <div className="form-error" role="alert"><AlertCircle size={17}/>{error}</div>}<button className="button primary login-button" disabled={ocupado} type="submit">{ocupado ? 'Ingresando…' : 'Entrar a mi tienda'}{!ocupado && <ArrowRight size={19}/>}</button></form><div className="login-foot"><ShieldCheck size={17}/> Acceso seguro para tu equipo</div></div></section></div>;
}
function useModalEsc(cerrar: () => void, ocupado: boolean) {
  useEffect(() => {
    const keydown = (e: KeyboardEvent) => { if (e.key === 'Escape' && !ocupado) cerrar(); };
    document.addEventListener('keydown', keydown);
    return () => document.removeEventListener('keydown', keydown);
  }, [cerrar, ocupado]);
}
function ModalProducto({ valor, categorias, onClose, onSave }: { valor: Producto | 'nuevo'; categorias: Categoria[]; onClose: () => void; onSave: (datos: ProductoForm) => Promise<void> }) {
  const nuevo = valor === 'nuevo';
  const [datos, setDatos] = useState<ProductoForm>({ codigo: nuevo ? '' : valor.codigo, nombre: nuevo ? '' : valor.nombre, precio: nuevo ? '' : String(valor.precio), stock: nuevo ? '' : String(valor.stock), vencimiento: nuevo ? '' : valor.vencimiento || '', categoria_id: nuevo || valor.categoria_id === null ? '' : String(valor.categoria_id), imagenArchivo: null, quitar_imagen: false });
  const [error, setError] = useState(''); const [ocupado, setOcupado] = useState(false);
  const principal = useRef<HTMLInputElement>(null);
  const [vistaPrevia, setVistaPrevia] = useState<string | null>(nuevo ? null : valor.imagen);
  useEffect(() => { principal.current?.focus(); }, []);
  useEffect(() => {
    if (!datos.imagenArchivo) { setVistaPrevia(datos.quitar_imagen || nuevo ? null : valor.imagen); return; }
    const url = URL.createObjectURL(datos.imagenArchivo);
    setVistaPrevia(url);
    return () => URL.revokeObjectURL(url);
  }, [datos.imagenArchivo, datos.quitar_imagen, nuevo, valor]);
  useModalEsc(onClose, ocupado);
  function set<K extends keyof ProductoForm>(key: K, value: ProductoForm[K]) { setDatos(prev => ({ ...prev, [key]: value })); }
  function elegirImagen(file: File | undefined) {
    if (!file) return;
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) { setError('Utiliza una imagen JPG, PNG o WEBP.'); return; }
    if (file.size > 3 * 1024 * 1024) { setError('La imagen no puede superar los 3 MB.'); return; }
    setError(''); setDatos(prev => ({ ...prev, imagenArchivo: file, quitar_imagen: false }));
  }
  function quitarImagen() { setDatos(prev => ({ ...prev, imagenArchivo: null, quitar_imagen: true })); }
  async function enviar(e: FormEvent<HTMLFormElement>) { e.preventDefault(); if (ocupado) return; setError(''); setOcupado(true); try { await onSave(datos); } catch (err) { setError((err as Error).message); } finally { setOcupado(false); } }
  return <div className="modal-scrim" onMouseDown={e => { if (e.target === e.currentTarget && !ocupado) onClose(); }}><section className="modal product-modal" role="dialog" aria-modal="true" aria-labelledby="product-title"><header className="modal-head"><div><span className="eyebrow">TU CATÁLOGO</span><h2 id="product-title">{nuevo ? 'Agregar producto' : 'Editar producto'}</h2><p>Organiza el producto y añade una foto para reconocerlo rápidamente.</p></div><button type="button" className="icon-btn" disabled={ocupado} onClick={onClose} aria-label="Cerrar"><X size={20}/></button></header><form onSubmit={enviar}><div className="modal-body">
    <div className="image-editor"><div className="image-preview">{vistaPrevia ? <img src={vistaPrevia} alt="Vista previa del producto"/> : <ImagePlus size={31}/>}</div><div className="image-editor-copy"><strong>Foto del producto <span className="optional">(opcional)</span></strong><p>Ayuda a reconocerlo en el inventario.</p><label htmlFor="p-image" className="button secondary upload-button"><ImagePlus size={17}/> {vistaPrevia ? 'Cambiar foto' : 'Subir foto'}</label><input id="p-image" className="file-input" type="file" accept="image/png,image/jpeg,image/webp" onChange={e => { elegirImagen(e.target.files?.[0]); e.currentTarget.value = ''; }}/>{vistaPrevia && <button className="remove-photo" type="button" onClick={quitarImagen}><ImageOff size={14}/> Quitar foto</button>}<small>JPG, PNG o WEBP · máximo 3 MB</small></div></div>
    <div className="field"><label htmlFor="p-name">Nombre del producto</label><input ref={principal} id="p-name" placeholder="Ej. Leche entera 1 litro" maxLength={140} required value={datos.nombre} onChange={e => set('nombre', e.target.value)}/></div>
    <div className="two-col"><div className="field"><label htmlFor="p-code">Código</label><input id="p-code" placeholder="Ej. 7801234567890" maxLength={40} required value={datos.codigo} onChange={e => set('codigo', e.target.value)}/></div><div className="field"><label htmlFor="p-category">Tipo de producto</label><select id="p-category" value={datos.categoria_id} onChange={e => set('categoria_id', e.target.value)}><option value="">Sin categoría</option>{categorias.map(c => <option key={c.id} value={c.id}>{c.nombre}</option>)}</select>{!categorias.length && <small className="help-text">Puedes crear tipos desde Productos → Organizar tipos.</small>}</div></div>
    <div className="two-col"><div className="field"><label htmlFor="p-price">Precio de venta ($)</label><input id="p-price" type="number" min="0" step="1" max="2147483647" required value={datos.precio} onChange={e => set('precio', e.target.value)}/></div><div className="field"><label htmlFor="p-stock">Cantidad disponible</label><input id="p-stock" type="number" min="0" step="1" max="2147483647" required value={datos.stock} onChange={e => set('stock', e.target.value)}/></div></div>
    <div className="field"><label htmlFor="p-exp">Fecha de vencimiento <span className="optional">(si corresponde)</span></label><input id="p-exp" type="date" value={datos.vencimiento} onChange={e => set('vencimiento', e.target.value)}/></div>
    {error && <div className="form-error" role="alert"><AlertCircle size={17}/>{error}</div>}
  </div><footer className="modal-footer"><button className="button secondary" type="button" disabled={ocupado} onClick={onClose}>Cancelar</button><button className="button primary" type="submit" disabled={ocupado}>{ocupado ? 'Guardando…' : 'Guardar producto'}<Check size={17}/></button></footer></form></section></div>;
}
function ModalCategorias({ categorias, onClose, onSave, onDelete }: { categorias: Categoria[]; onClose: () => void; onSave: (nombre: string, editar: Categoria | null) => Promise<void>; onDelete: (categoria: Categoria) => Promise<void> }) {
  const [nombre, setNombre] = useState('');
  const [editar, setEditar] = useState<Categoria | null>(null);
  const [ocupado, setOcupado] = useState(false);
  const [error, setError] = useState('');
  useModalEsc(onClose, ocupado);
  async function guardar(e: FormEvent<HTMLFormElement>) {
    e.preventDefault(); if (ocupado) return; setOcupado(true); setError('');
    try { await onSave(nombre.trim(), editar); setNombre(''); setEditar(null); }
    catch (err) { setError((err as Error).message); }
    finally { setOcupado(false); }
  }
  async function quitar(c: Categoria) {
    if (ocupado) return;
    setError(''); setOcupado(true);
    try { await onDelete(c); if (editar?.id === c.id) { setEditar(null); setNombre(''); } }
    catch (err) { setError((err as Error).message); }
    finally { setOcupado(false); }
  }
  return <div className="modal-scrim" onMouseDown={e => { if (e.target === e.currentTarget && !ocupado) onClose(); }}><section className="modal" role="dialog" aria-modal="true" aria-labelledby="cat-title"><header className="modal-head"><div><span className="eyebrow">ORGANIZA TU TIENDA</span><h2 id="cat-title">Tipos de producto</h2><p>Crea grupos como Bebidas, Abarrotes o Limpieza. Después asigna cada producto a su tipo.</p></div><button type="button" className="icon-btn" disabled={ocupado} onClick={onClose} aria-label="Cerrar"><X size={20}/></button></header><div className="modal-body"><form className="category-form" onSubmit={guardar}><div className="field"><label htmlFor="cat-name">{editar ? 'Cambiar nombre' : 'Nuevo tipo de producto'}</label><input id="cat-name" placeholder="Ej. Bebidas" maxLength={60} minLength={2} value={nombre} onChange={e => setNombre(e.target.value)} required/></div><button type="submit" className="button primary" disabled={ocupado || !nombre.trim()}>{editar ? 'Guardar' : 'Agregar tipo'}</button>{editar && <button type="button" className="button secondary" onClick={() => {setEditar(null); setNombre(''); setError('');}}>Cancelar</button>}</form>{error && <div className="form-error" role="alert"><AlertCircle size={17}/>{error}</div>}<div className="category-list">{categorias.map(c => <div className="category-item" key={c.id}><span className="category-item-icon"><Tag size={18}/></span><span className="category-item-text"><strong>{c.nombre}</strong><small>{c.productos} producto{c.productos === 1 ? '' : 's'}</small></span><button type="button" title={`Editar ${c.nombre}`} aria-label={`Editar ${c.nombre}`} disabled={ocupado} className="icon-btn" onClick={() => {setEditar(c); setNombre(c.nombre); setError('');}}><Pencil size={17}/></button><button type="button" title={c.productos ? 'Mueve primero sus productos a otro tipo' : `Eliminar ${c.nombre}`} aria-label={`Eliminar ${c.nombre}`} disabled={ocupado || c.productos > 0} className="icon-btn delete-action" onClick={() => quitar(c)}><Trash2 size={17}/></button></div>)}{!categorias.length && <p className="category-empty">Todavía no hay tipos. Crea el primero para ordenar tu catálogo.</p>}</div><small className="help-text">Para eliminar un tipo, primero cambia de categoría sus productos.</small></div><footer className="modal-footer"><button type="button" className="button secondary" disabled={ocupado} onClick={onClose}>Listo</button></footer></section></div>;
}
function FichaUsuario({ usuario, onClose, onEdit, onPassword, onEstado }: { usuario: Usuario; onClose: () => void; onEdit: () => void; onPassword: () => void; onEstado: () => void }) {
  useModalEsc(onClose, false);
  const puedeGestionar = !usuario.protegido || usuario.es_actual;
  return <div className="modal-scrim" onMouseDown={e => { if (e.target === e.currentTarget) onClose(); }}><section className="modal user-sheet" role="dialog" aria-modal="true" aria-labelledby="ficha-title"><header className="modal-head"><div><span className="eyebrow">CUENTA DE PERSONAL</span><h2 id="ficha-title">Datos de acceso</h2><p>Revisa la información y administra esta cuenta.</p></div><button type="button" className="icon-btn" aria-label="Cerrar" onClick={onClose}><X size={20}/></button></header>
    <div className="modal-body"><div className="person-profile"><FotoUsuario usuario={usuario} className="profile-avatar"/><div><h3>{usuario.nombre}</h3><p>@{usuario.usuario}{usuario.es_actual ? ' · Tu cuenta' : ''}</p></div><span className={`pill ${usuario.activo ? 'normal' : 'muted'}`}>{usuario.activo ? 'Habilitada' : 'Suspendida'}</span></div>
      <dl className="profile-fields"><div><dt>Perfil</dt><dd>{usuario.rol}</dd></div><div><dt>Último ingreso</dt><dd>{fechaHora(usuario.ultimo_acceso)}</dd></div><div><dt>Cuenta creada</dt><dd>{fechaCorta(usuario.creado_el)}</dd></div></dl>
      {usuario.protegido && !usuario.es_actual && <p className="profile-notice"><ShieldAlert size={18}/> Esta cuenta principal está protegida. Solo su titular puede modificarla.</p>}
      {puedeGestionar && <div className="profile-actions"><button type="button" onClick={onEdit}><UserRoundCog size={20}/><span><strong>Editar datos y permisos</strong><small>Cambiar nombre, usuario o perfil</small></span><ChevronRight size={17}/></button><button type="button" onClick={onPassword}><KeyRound size={20}/><span><strong>Cambiar contraseña</strong><small>{usuario.es_actual ? 'Se pedirá tu contraseña actual' : 'Asignar una contraseña nueva'}</small></span><ChevronRight size={17}/></button>{!usuario.es_actual && !usuario.protegido && <button className={usuario.activo ? 'profile-danger' : ''} type="button" onClick={onEstado}>{usuario.activo ? <UserRoundX size={20}/> : <UserRoundCheck size={20}/>}<span><strong>{usuario.activo ? 'Suspender acceso' : 'Reactivar acceso'}</strong><small>{usuario.activo ? 'No podrá iniciar sesión hasta reactivarla' : 'Podrá volver a ingresar con su contraseña'}</small></span><ChevronRight size={17}/></button>}</div>}
    </div><footer className="modal-footer"><button type="button" className="button secondary" onClick={onClose}>Cerrar</button></footer></section></div>;
}
function ModalUsuario({ valor, onClose, onSave }: { valor: Usuario | 'nuevo'; onClose: () => void; onSave: (datos: UsuarioForm) => Promise<void> }) {
  const nuevo = valor === 'nuevo';
  const esPrincipal = !nuevo && valor.protegido;
  const [datos, setDatos] = useState<UsuarioForm>({ nombre: nuevo ? '' : valor.nombre, usuario: nuevo ? '' : valor.usuario, rol: nuevo ? 'Cajero' : valor.rol === 'Administrador' ? 'Administrador' : 'Cajero', activo: nuevo ? true : valor.activo, clave: '', fotoArchivo: null, quitar_foto: false });
  const [confirma, setConfirma] = useState('');
  const [visible, setVisible] = useState(false); const [error, setError] = useState(''); const [ocupado, setOcupado] = useState(false);
  const principal = useRef<HTMLInputElement>(null);
  const [vistaFoto, setVistaFoto] = useState<string | null>(nuevo ? null : valor.foto);
  useEffect(() => { principal.current?.focus(); }, []);
  useEffect(() => {
    if (!datos.fotoArchivo) { setVistaFoto(datos.quitar_foto || nuevo ? null : valor.foto); return; }
    const url = URL.createObjectURL(datos.fotoArchivo);
    setVistaFoto(url);
    return () => URL.revokeObjectURL(url);
  }, [datos.fotoArchivo, datos.quitar_foto, nuevo, valor]);
  useModalEsc(onClose, ocupado);
  function set<K extends keyof UsuarioForm>(campo: K, value: UsuarioForm[K]) { setDatos(prev => ({ ...prev, [campo]: value })); }
  function elegirFoto(archivo: File | undefined) {
    if (!archivo) return;
    if (!['image/png', 'image/jpeg', 'image/webp'].includes(archivo.type)) { setError('La fotografía debe ser JPG, PNG o WEBP.'); return; }
    if (archivo.size > 3 * 1024 * 1024 || !archivo.size) { setError('La fotografía no puede superar los 3 MB.'); return; }
    setError(''); setDatos(prev => ({ ...prev, fotoArchivo: archivo, quitar_foto: false }));
  }
  function quitarFoto() { setDatos(prev => ({ ...prev, fotoArchivo: null, quitar_foto: true })); }
  async function enviar(e: FormEvent<HTMLFormElement>) {
    e.preventDefault(); if (ocupado) return;
    if (nuevo && datos.clave !== confirma) { setError('Las contraseñas no coinciden.'); return; }
    setError(''); setOcupado(true); try { await onSave(datos); } catch (err) { setError((err as Error).message); } finally { setOcupado(false); }
  }
  return <div className="modal-scrim" onMouseDown={e => { if (e.target === e.currentTarget && !ocupado) onClose(); }}><section className="modal" role="dialog" aria-modal="true" aria-labelledby="user-title"><header className="modal-head"><div><span className="eyebrow">TU EQUIPO</span><h2 id="user-title">{nuevo ? 'Agregar persona' : 'Editar información'}</h2><p>{nuevo ? 'Crea una cuenta para que esta persona entre a Merqia.' : 'Actualiza los datos de esta cuenta.'}</p></div><button className="icon-btn" type="button" disabled={ocupado} onClick={onClose} aria-label="Cerrar"><X size={20}/></button></header><form onSubmit={enviar}><div className="modal-body"><div className="image-editor profile-photo-editor"><div className="image-preview profile-image-preview">{vistaFoto ? <img src={vistaFoto} alt="Vista previa de la foto de perfil"/> : <Users size={30}/>}</div><div className="image-editor-copy"><strong>Foto de perfil <span className="optional">(opcional)</span></strong><p>Identifica rápidamente a esta persona en tu equipo.</p><label htmlFor="u-photo" className="button secondary upload-button"><ImagePlus size={17}/> {vistaFoto ? 'Cambiar foto' : 'Agregar foto'}</label><input id="u-photo" className="file-input" type="file" accept="image/png,image/jpeg,image/webp" disabled={ocupado} onChange={e => { elegirFoto(e.target.files?.[0]); e.currentTarget.value = ''; }}/>{vistaFoto && <button className="remove-photo" type="button" disabled={ocupado} onClick={quitarFoto}><ImageOff size={14}/> Quitar foto</button>}<small>JPG, PNG o WEBP · máximo 3 MB</small></div></div><div className="field"><label htmlFor="u-name">Nombre de la persona</label><input ref={principal} id="u-name" placeholder="Ej. Camila Torres" minLength={2} maxLength={100} required value={datos.nombre} onChange={e => set('nombre', e.target.value)}/></div><div className="field"><label htmlFor="u-user">Nombre de usuario</label><input id="u-user" placeholder="Ej. camila.torres" minLength={3} maxLength={150} required autoComplete="off" value={datos.usuario} onChange={e => set('usuario', e.target.value)}/><small className="help-text">Lo utilizará al iniciar sesión. No debe llevar espacios.</small></div><div className="field"><label htmlFor="u-role">Tipo de cuenta</label><select id="u-role" value={datos.rol} disabled={Boolean(esPrincipal || (!nuevo && valor.es_actual))} onChange={e => set('rol', e.target.value as UsuarioForm['rol'])}><option value="Cajero">Cajero — consulta de productos</option><option value="Administrador">Administrador — gestión completa</option></select>{!nuevo && valor.es_actual && <small className="help-text">Por seguridad, no puedes cambiar tu propio perfil de administrador.</small>}</div>
      {nuevo && <><div className="field"><label htmlFor="u-pass">Contraseña inicial</label><div className="password-field"><input id="u-pass" type={visible ? 'text' : 'password'} minLength={8} required autoComplete="new-password" value={datos.clave} onChange={e => set('clave', e.target.value)} placeholder="Mínimo 8 caracteres"/><button type="button" aria-label={visible ? 'Ocultar contraseña' : 'Mostrar contraseña'} onClick={() => setVisible(!visible)}>{visible ? <EyeOff size={18}/> : <Eye size={18}/>}</button></div></div><div className="field"><label htmlFor="u-confirm">Confirmar contraseña</label><input id="u-confirm" type={visible ? 'text' : 'password'} required autoComplete="new-password" value={confirma} onChange={e => setConfirma(e.target.value)} placeholder="Repite la contraseña"/></div><div className="profile-notice"><ShieldCheck size={18}/> Comparte la contraseña directamente con la persona. Merqia no la mostrará después.</div></>}
      {error && <div className="form-error" role="alert"><AlertCircle size={17}/>{error}</div>}</div><footer className="modal-footer"><button className="button secondary" type="button" disabled={ocupado} onClick={onClose}>Cancelar</button><button className="button primary" type="submit" disabled={ocupado}>{ocupado ? 'Guardando…' : nuevo ? 'Crear cuenta' : 'Guardar cambios'}<Check size={17}/></button></footer></form></section></div>;
}
function ModalFotoPropia({ usuario, onClose, onSave }: { usuario: Usuario; onClose: () => void; onSave: (foto: File | null, quitar: boolean) => Promise<void> }) {
  const [archivo, setArchivo] = useState<File | null>(null);
  const [quitar, setQuitar] = useState(false);
  const [vistaFoto, setVistaFoto] = useState<string | null>(usuario.foto);
  const [error, setError] = useState('');
  const [ocupado, setOcupado] = useState(false);
  useEffect(() => {
    if (!archivo) { setVistaFoto(quitar ? null : usuario.foto); return; }
    const url = URL.createObjectURL(archivo);
    setVistaFoto(url);
    return () => URL.revokeObjectURL(url);
  }, [archivo, quitar, usuario.foto]);
  useModalEsc(onClose, ocupado);
  function elegirFoto(file: File | undefined) {
    if (!file) return;
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) { setError('Utiliza una fotografía JPG, PNG o WEBP.'); return; }
    if (!file.size || file.size > 3 * 1024 * 1024) { setError('El tamaño máximo de la foto es de 3 MB.'); return; }
    setError(''); setArchivo(file); setQuitar(false);
  }
  async function enviar(e: FormEvent<HTMLFormElement>) {
    e.preventDefault(); if (ocupado || (!archivo && !quitar)) return;
    setOcupado(true); setError('');
    try { await onSave(archivo, quitar); } catch (err) { setError((err as Error).message); }
    finally { setOcupado(false); }
  }
  return <div className="modal-scrim" onMouseDown={e => { if (e.target === e.currentTarget && !ocupado) onClose(); }}><section className="modal" role="dialog" aria-modal="true" aria-labelledby="mi-foto-titulo"><header className="modal-head"><div><span className="eyebrow">TU CUENTA</span><h2 id="mi-foto-titulo">Mi foto de perfil</h2><p>Una fotografía ayuda a tus compañeros a reconocerte fácilmente.</p></div><button type="button" className="icon-btn" aria-label="Cerrar" disabled={ocupado} onClick={onClose}><X size={20}/></button></header><form onSubmit={enviar}><div className="modal-body"><div className="image-editor profile-photo-editor"><div className="image-preview profile-image-preview">{vistaFoto ? <img src={vistaFoto} alt="Vista previa de tu foto"/> : <Users size={30}/>}</div><div className="image-editor-copy"><strong>{usuario.nombre}</strong><p>Selecciona una imagen de tu dispositivo.</p><label htmlFor="mi-foto-input" className="button secondary upload-button"><ImagePlus size={17}/> {vistaFoto ? 'Cambiar foto' : 'Agregar foto'}</label><input id="mi-foto-input" className="file-input" type="file" accept="image/png,image/jpeg,image/webp" disabled={ocupado} onChange={e => { elegirFoto(e.target.files?.[0]); e.currentTarget.value = ''; }}/>{vistaFoto && <button type="button" className="remove-photo" disabled={ocupado} onClick={() => { setArchivo(null); setQuitar(true); }}><ImageOff size={14}/> Quitar foto</button>}<small>JPG, PNG o WEBP · máximo 3 MB</small></div></div>{error && <div className="form-error" role="alert"><AlertCircle size={17}/>{error}</div>}</div><footer className="modal-footer"><button className="button secondary" type="button" disabled={ocupado} onClick={onClose}>Cancelar</button><button className="button primary" type="submit" disabled={ocupado || (!archivo && !quitar)}>{ocupado ? 'Guardando…' : 'Guardar foto'}<Check size={17}/></button></footer></form></section></div>;
}
function ModalClave({ usuario, onClose, onSave }: { usuario: Usuario; onClose: () => void; onSave: (clave: string, actual: string) => Promise<void> }) {
  const [clave, setClave] = useState(''); const [confirmar, setConfirmar] = useState(''); const [actual, setActual] = useState('');
  const [visible, setVisible] = useState(false); const [error, setError] = useState(''); const [ocupado, setOcupado] = useState(false);
  useModalEsc(onClose, ocupado);
  async function enviar(e: FormEvent<HTMLFormElement>) { e.preventDefault(); if (ocupado) return; if (clave !== confirmar) {setError('Las contraseñas no coinciden.'); return;} setError(''); setOcupado(true); try {await onSave(clave, actual);} catch(err){setError((err as Error).message);} finally {setOcupado(false);} }
  return <div className="modal-scrim" onMouseDown={e => {if(e.target === e.currentTarget && !ocupado) onClose();}}><section className="modal" role="dialog" aria-modal="true" aria-labelledby="pass-title"><header className="modal-head"><div><span className="eyebrow">SEGURIDAD DE LA CUENTA</span><h2 id="pass-title">Cambiar contraseña</h2><p>{usuario.es_actual ? 'Para proteger tu cuenta, confirma tu contraseña actual.' : `Asigna una clave nueva a ${usuario.nombre}.`}</p></div><button type="button" className="icon-btn" disabled={ocupado} onClick={onClose} aria-label="Cerrar"><X size={20}/></button></header><form onSubmit={enviar}><div className="modal-body">
    {usuario.es_actual && <div className="field"><label htmlFor="pass-current">Tu contraseña actual</label><input id="pass-current" type="password" autoComplete="current-password" required value={actual} onChange={e=>setActual(e.target.value)}/></div>}
    <div className="field"><label htmlFor="pass-new">Nueva contraseña</label><div className="password-field"><input id="pass-new" type={visible?'text':'password'} autoComplete="new-password" minLength={8} required value={clave} onChange={e=>setClave(e.target.value)} placeholder="Una clave segura y fácil de recordar"/><button type="button" aria-label={visible?'Ocultar contraseña':'Mostrar contraseña'} onClick={()=>setVisible(!visible)}>{visible?<EyeOff size={18}/>:<Eye size={18}/>}</button></div></div>
    <div className="field"><label htmlFor="pass-confirm">Repetir nueva contraseña</label><input id="pass-confirm" type={visible?'text':'password'} required autoComplete="new-password" value={confirmar} onChange={e=>setConfirmar(e.target.value)}/><small className="help-text">Mínimo 8 caracteres. No uses claves comunes ni parecidas al nombre de usuario.</small></div>
    {error && <div className="form-error" role="alert"><AlertCircle size={17}/>{error}</div>}</div><footer className="modal-footer"><button type="button" className="button secondary" onClick={onClose} disabled={ocupado}>Cancelar</button><button type="submit" className="button primary" disabled={ocupado}>{ocupado?'Guardando…':'Cambiar contraseña'}<KeyRound size={17}/></button></footer></form></section></div>;
}
function ConfirmarEstado({ usuario, onClose, onConfirm }: { usuario: Usuario; onClose: () => void; onConfirm: () => Promise<void> }) {
  const [error, setError] = useState(''); const [ocupado, setOcupado] = useState(false);
  useModalEsc(onClose, ocupado);
  async function confirmar() {if (ocupado) return; setOcupado(true); setError(''); try {await onConfirm();} catch(err){setError((err as Error).message);} finally {setOcupado(false);} }
  return <div className="modal-scrim" onMouseDown={e=>{if(e.target===e.currentTarget && !ocupado)onClose();}}><section className="modal confirm-modal" role="alertdialog" aria-modal="true" aria-labelledby="state-title" aria-describedby="state-desc"><div className="delete-icon">{usuario.activo?<UserRoundX size={25}/>:<UserRoundCheck size={25}/>}</div><h2 id="state-title">{usuario.activo?'¿Suspender acceso?':'¿Reactivar cuenta?'}</h2><p id="state-desc">{usuario.activo? <><strong>{usuario.nombre}</strong> no podrá entrar a Merqia, pero sus datos quedarán guardados.</> : <><strong>{usuario.nombre}</strong> podrá volver a ingresar con sus credenciales.</>}</p>{error && <div className="form-error" role="alert"><AlertCircle size={17}/>{error}</div>}<div className="confirm-actions"><button type="button" className="button secondary" disabled={ocupado} onClick={onClose}>Cancelar</button><button type="button" className={usuario.activo?'button danger':'button primary'} disabled={ocupado} onClick={confirmar}>{ocupado?'Guardando…':usuario.activo?'Suspender acceso':'Reactivar cuenta'}</button></div></section></div>;
}
function ConfirmarBorrado({ producto, onClose, onConfirm }: { producto: Producto; onClose: () => void; onConfirm: () => Promise<void> }) {
  const [error, setError] = useState(''); const [ocupado, setOcupado] = useState(false);
  const boton = useRef<HTMLButtonElement>(null);
  useEffect(() => { boton.current?.focus(); }, []);
  useModalEsc(onClose, ocupado);
  async function confirmar() { if (ocupado) return; setOcupado(true); setError(''); try { await onConfirm(); } catch (err) { setError((err as Error).message); } finally { setOcupado(false); } }
  return <div className="modal-scrim" onMouseDown={e => { if (e.target === e.currentTarget && !ocupado) onClose(); }}><section className="modal confirm-modal" role="alertdialog" aria-modal="true" aria-labelledby="delete-title" aria-describedby="delete-desc"><div className="delete-icon"><Trash2 size={26}/></div><h2 id="delete-title">¿Retirar este producto?</h2><p id="delete-desc"><strong>{producto.nombre}</strong> dejará de aparecer en el catálogo y en ventas. Sus ventas anteriores seguirán registradas. Puedes recuperarlo desde Productos → Ver archivados.</p>{error && <div className="form-error" role="alert"><AlertCircle size={17}/>{error}</div>}<div className="confirm-actions"><button ref={boton} className="button secondary" disabled={ocupado} onClick={onClose}>Cancelar</button><button className="button danger" type="button" disabled={ocupado} onClick={confirmar}>{ocupado ? 'Retirando…' : 'Retirar producto'}</button></div></section></div>;
}
export default App;
