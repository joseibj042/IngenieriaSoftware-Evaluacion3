import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import {
  AlertCircle, ArrowDownCircle, ArrowUpCircle, Banknote, CalendarClock, Check,
  CheckCircle2, ChevronRight, CreditCard, Download, Keyboard,
  Minus, Package, Plus, Printer, ReceiptText, RefreshCw, Search,
  Settings2, ShoppingBag, Trash2, Wallet, X, type LucideIcon,
} from 'lucide-react';
import './comercio.css';

type Producto = { id: number; codigo: string; nombre: string; precio: number; stock: number; vencimiento: string | null; categoria_id: number | null; categoria: string | null; imagen: string | null };
type Movimiento = { id: number; tipo: 'ingreso' | 'retiro'; monto: number; motivo: string; usuario: string; fecha_hora: string };
type Caja = { id: number; responsable: string; fecha_apertura: string; fecha_cierre: string | null; monto_inicial: number; monto_contado: number | null; diferencia: number | null; saldo_esperado: number; ventas_efectivo: number; ventas_tarjeta: number; total_ventas: number; total_ingresos: number; total_retiros: number; movimientos?: Movimiento[] };
type Detalle = { producto_id: number; nombre: string; codigo: string; cantidad: number; precio_unitario: number; subtotal: number };
type Venta = { id: number; fecha_hora: string; usuario: string; caja_id: number; metodo_pago: 'tarjeta' | 'efectivo'; total: number; monto_recibido: number; vuelto: number; items?: Detalle[] };
type Estado = { caja: Caja | null; historial: Caja[]; configuracion: { dias_alerta: number }; ventas_hoy: number; total_hoy: number; ultimas_ventas: Venta[]; es_admin: boolean };
type Vista = 'venta' | 'caja' | 'historial';
type Api = <T>(ruta: string, opciones?: RequestInit) => Promise<T>;
const CLP = (n: number) => new Intl.NumberFormat('es-CL', { style: 'currency', currency: 'CLP', maximumFractionDigits: 0 }).format(n);
const corto = (fecha: string) => new Date(fecha).toLocaleString('es-CL', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
const numero = (v: string) => /^\d+$/.test(v) && Number.isSafeInteger(Number(v)) ? Number(v) : NaN;
const crearToken = () => crypto.randomUUID();
const fechaHoyLocal = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`; };
const validoParaVender = (p: Producto) => p.stock > 0 && (!p.vencimiento || p.vencimiento >= fechaHoyLocal());

type Props = { productos: Producto[]; categorias: {id: number; nombre: string}[]; admin: boolean; api: Api; onRefresh: () => Promise<void> };

export default function Comercio({ productos, categorias, admin, api, onRefresh }: Props) {
  const [vista, setVista] = useState<Vista>('venta');
  const [estado, setEstado] = useState<Estado | null>(null);
  const [historial, setHistorial] = useState<Venta[]>([]);
  const [error, setError] = useState('');
  const [mensaje, setMensaje] = useState('');
  const [ocupado, setOcupado] = useState(false);
  const [busqueda, setBusqueda] = useState('');
  const [categoria, setCategoria] = useState('todas');
  const [carrito, setCarrito] = useState<Record<number, number>>({});
  const [medio, setMedio] = useState<'efectivo' | 'tarjeta'>('efectivo');
  const [recibido, setRecibido] = useState('');
  const [confirmar, setConfirmar] = useState(false);
  const [token, setToken] = useState(crearToken);
  const [ticket, setTicket] = useState<Venta | null>(null);
  const [fondo, setFondo] = useState('');
  const [tipoMovimiento, setTipoMovimiento] = useState<'ingreso' | 'retiro'>('ingreso');
  const [montoMovimiento, setMontoMovimiento] = useState('');
  const [motivoMovimiento, setMotivoMovimiento] = useState('');
  const [mostrarMovimiento, setMostrarMovimiento] = useState(false);
  const [contado, setContado] = useState('');
  const [mostrarCierre, setMostrarCierre] = useState(false);
  const [diasAviso, setDiasAviso] = useState('7');
  const [verAjustes, setVerAjustes] = useState(false);
  const buscador = useRef<HTMLInputElement>(null);

  const cargar = useCallback(async () => {
    const result = await api<Estado>('/api/comercio/estado/');
    setEstado(result);
    setDiasAviso(String(result.configuracion.dias_alerta));
    return result;
  }, [api]);
  useEffect(() => {
    let activo = true;
    api<Estado>('/api/comercio/estado/').then(d => { if (activo) { setEstado(d); setDiasAviso(String(d.configuracion.dias_alerta)); } })
      .catch(e => { if (activo) setError((e as Error).message); });
    return () => { activo = false; };
  }, [api]);

  const cesta = useMemo(() => productos.filter(p => carrito[p.id] > 0).map(p => ({ ...p, cantidad: carrito[p.id], subtotal: p.precio * carrito[p.id] })), [productos, carrito]);
  const total = cesta.reduce((sum, p) => sum + p.subtotal, 0);
  const efectivo = numero(recibido);
  const vuelto = Number.isFinite(efectivo) && efectivo >= total ? efectivo - total : null;
  const filtrados = useMemo(() => productos.filter(p => {
    const q = busqueda.toLocaleLowerCase('es').trim();
    return (!q || `${p.nombre} ${p.codigo} ${p.categoria || ''}`.toLocaleLowerCase('es').includes(q)) && (categoria === 'todas' || p.categoria_id === Number(categoria));
  }).sort((a, b) => a.nombre.localeCompare(b.nombre, 'es')), [productos, busqueda, categoria]);

  const cambiarCantidad = (id: number, cantidad: number) => {
    if (!Number.isSafeInteger(cantidad) || cantidad < 0) return;
    const p = productos.find(x => x.id === id);
    if (!p || cantidad > p.stock) { setError(`No hay suficientes unidades de ${p?.nombre || 'ese producto'}.`); return; }
    setCarrito(old => { const siguiente = { ...old }; if (cantidad === 0) delete siguiente[id]; else siguiente[id] = cantidad; return siguiente; });
    setToken(crearToken()); setConfirmar(false); setError('');
  };
  const agregar = (p: Producto) => {
    if (!validoParaVender(p)) { setError(p.stock === 0 ? 'Este producto está agotado.' : 'No puedes vender un producto vencido.'); return; }
    cambiarCantidad(p.id, (carrito[p.id] || 0) + 1);
  };
  const elegirMedio = (v: 'efectivo' | 'tarjeta') => { setMedio(v); setToken(crearToken()); setConfirmar(false); };
  const cambiarRecibido = (v: string) => { setRecibido(v); setToken(crearToken()); setConfirmar(false); };

  const ejecutar = async (accion: () => Promise<void>) => {
    if (ocupado) return;
    setOcupado(true); setError(''); setMensaje('');
    try { await accion(); }
    catch (e) { setError((e as Error).message); }
    finally { setOcupado(false); }
  };

  const registrarVenta = () => ejecutar(async () => {
    const respuesta = await api<{venta: Venta; repetida: boolean}>('/api/comercio/venta/', {
      method: 'POST', body: JSON.stringify({ token, metodo_pago: medio, monto_recibido: medio === 'efectivo' ? efectivo : 0,
        items: cesta.map(p => ({producto_id:p.id, cantidad:p.cantidad})) }),
    });
    const venta = respuesta.venta;
    setTicket(venta); setCarrito({}); setRecibido(''); setConfirmar(false); setToken(crearToken());
    setMensaje(respuesta.repetida ? `Venta #${venta.id} recuperada sin duplicar el cobro.` : `Venta #${venta.id} guardada y stock actualizado.`);
    await Promise.all([cargar(), onRefresh()]);
  });
  const abrir = (e: FormEvent) => { e.preventDefault(); ejecutar(async () => {
    await api('/api/comercio/abrir/', { method: 'POST', body: JSON.stringify({monto_inicial: numero(fondo)}) });
    setFondo(''); await cargar(); setVista('venta'); setMensaje('Caja abierta. Ya puedes registrar ventas.');
  }); };
  const movimiento = (e: FormEvent) => { e.preventDefault(); ejecutar(async () => {
    await api('/api/comercio/movimiento/', {method:'POST', body:JSON.stringify({tipo:tipoMovimiento, monto:numero(montoMovimiento), motivo:motivoMovimiento})});
    setMontoMovimiento(''); setMotivoMovimiento(''); setMostrarMovimiento(false); await cargar(); setMensaje('Movimiento de caja registrado.');
  }); };
  const cerrar = (e: FormEvent) => { e.preventDefault(); ejecutar(async () => {
    const respuesta = await api<{mensaje:string; respaldo_creado:boolean}>('/api/comercio/cerrar/', {method:'POST', body:JSON.stringify({monto_contado: numero(contado)})});
    setMostrarCierre(false); setContado(''); setCarrito({}); setConfirmar(false);
    await cargar(); setVista('caja'); setMensaje(respuesta.mensaje);
  }); };
  const guardarAjustes = (e: FormEvent) => { e.preventDefault(); ejecutar(async () => {
    await api('/api/comercio/configuracion/', {method:'PUT',body:JSON.stringify({dias_alerta:numero(diasAviso)})});
    setVerAjustes(false); await Promise.all([cargar(), onRefresh()]); setMensaje('Avisos de vencimiento actualizados.');
  }); };
  const descargar = () => ejecutar(async () => {
    const token = await fetch('/api/csrf/', {credentials:'same-origin'});
    if (!token.ok) throw Error('No se pudo verificar la sesión.');
    const datos = await token.json() as {csrfToken:string};
    const respuesta = await fetch('/api/comercio/respaldo/', {method:'POST', credentials:'same-origin', headers:{'X-CSRFToken':datos.csrfToken}});
    if (!respuesta.ok) {
      const problema = await respuesta.json().catch(() => ({})) as {error?:string};
      throw Error(problema.error || 'No se pudo descargar el respaldo.');
    }
    const enlace = URL.createObjectURL(await respuesta.blob());
    const a = document.createElement('a'); a.href = enlace; a.download = `merqia_respaldo_${new Date().toISOString().slice(0,10)}.zip`;
    document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(enlace), 5000);
    setMensaje('Respaldo generado y descargado. Guárdalo en un lugar seguro.');
  });
  const cargarHistorial = () => ejecutar(async () => {
    const data = await api<{ventas:Venta[]}>('/api/comercio/ventas/'); setHistorial(data.ventas);
  });

  useEffect(() => {
    const manejar = (e: KeyboardEvent) => {
      if (vista !== 'venta' || !estado?.caja || ticket) return;
      if (e.key === 'F2') { e.preventDefault(); buscador.current?.focus(); buscador.current?.select(); }
      if (e.altKey && e.key === '1') { e.preventDefault(); elegirMedio('efectivo'); }
      if (e.altKey && e.key === '2') { e.preventDefault(); elegirMedio('tarjeta'); }
      if (e.ctrlKey && e.key === 'Enter') { e.preventDefault(); if (cesta.length) setConfirmar(true); }
      if (e.key === 'Escape') setConfirmar(false);
    };
    window.addEventListener('keydown', manejar);
    return () => window.removeEventListener('keydown', manejar);
  }, [estado?.caja, vista, ticket, cesta.length]);

  const caja = estado?.caja;
  const sePuedePagar = cesta.length > 0 && total > 0 && total <= 2147483647 && cesta.every(p => p.cantidad <= p.stock && validoParaVender(p)) && (medio === 'tarjeta' || (Number.isSafeInteger(efectivo) && efectivo >= total && efectivo <= 2147483647));

  return <div className="commerce-root">
    <div className="page-title commerce-header"><div><span className="eyebrow">PUNTO DE VENTA</span><h1>Ventas y caja<span className="accent">.</span></h1><p>Atiende a tus clientes y controla el dinero de tu negocio, sin complicaciones.</p></div>
      <span className={`commerce-open-indicator ${caja ? 'is-open' : ''}`}><span/>{caja ? `Caja abierta · Turno #${caja.id}` : 'Caja cerrada'}</span>
    </div>
    {error && <div className="toast error" role="alert"><AlertCircle size={18}/><span>{error}</span><button type="button" aria-label="Cerrar error" onClick={() => setError('')}><X size={17}/></button></div>}
    {mensaje && <div className="toast success" role="status"><CheckCircle2 size={18}/><span>{mensaje}</span><button type="button" aria-label="Cerrar mensaje" onClick={() => setMensaje('')}><X size={17}/></button></div>}
    <div className="commerce-tabs" role="tablist" aria-label="Operaciones del negocio">
      <Tab icon={ShoppingBag} label="Vender" activo={vista==='venta'} onClick={() => setVista('venta')}/>
      <Tab icon={Wallet} label="Mi caja" activo={vista==='caja'} onClick={() => setVista('caja')}/>
      <Tab icon={ReceiptText} label="Historial" activo={vista==='historial'} onClick={() => {setVista('historial'); void cargarHistorial();}}/>
    </div>
    {!estado && <section className="card commerce-note"><RefreshCw size={22}/> Consultando el estado de tu tienda…</section>}
    {estado && vista==='venta' && !caja && <section className="card commerce-empty"><Wallet size={39}/><h2>Primero abre tu caja</h2><p>Antes de cobrar necesitas registrar el dinero inicial del turno. Así podrás cuadrar el efectivo al cerrar.</p><button className="button primary" onClick={() => setVista('caja')} type="button">Abrir caja <ChevronRight size={18}/></button></section>}
    {estado && vista==='venta' && caja && <div className="commerce-sale-layout">
      <section className="card commerce-catalog">
        <div className="commerce-section-header"><div><h2>Elige los productos</h2><p>Busca por nombre o código y añádelos al cobro.</p></div><span className="commerce-inline-count">{filtrados.length} disponibles en lista</span></div>
        <div className="commerce-filters"><label className="commerce-search"><Search size={19}/><input ref={buscador} placeholder="Buscar o leer código · F2" value={busqueda} onChange={e=>setBusqueda(e.target.value)} onKeyDown={e=>{if(e.key==='Enter' && filtrados.length){e.preventDefault();const exacto=filtrados.find(p=>p.codigo.toLocaleLowerCase('es')===busqueda.trim().toLocaleLowerCase('es')); agregar(exacto || filtrados[0]);}}}/></label><select aria-label="Categoría" value={categoria} onChange={e=>setCategoria(e.target.value)}><option value="todas">Todas las categorías</option>{categorias.map(c=><option key={c.id} value={c.id}>{c.nombre}</option>)}</select></div>
        <div className="commerce-products">{filtrados.map(p=><button type="button" key={p.id} className="commerce-product" disabled={!validoParaVender(p)} onClick={()=>agregar(p)}><span className="commerce-product-photo">{p.imagen?<img src={p.imagen} alt=""/>:<Package size={25}/>}</span><span className="commerce-product-desc"><strong>{p.nombre}</strong><small>{p.categoria || 'Sin categoría'} · {p.codigo}</small><small className={!validoParaVender(p)?'commerce-warning':''}>{p.stock===0?'Sin stock':!validoParaVender(p)?'Producto vencido':`${p.stock} en stock`}</small></span><span className="commerce-product-price"><b>{CLP(p.precio)}</b><Plus size={18}/></span></button>)}</div>
        {!filtrados.length && <div className="commerce-note">No hay productos con esa búsqueda. Prueba otro nombre o categoría.</div>}
      </section>
      <section className="card commerce-checkout"><div className="commerce-section-header"><div><h2>Cobro actual</h2><p>{cesta.length ? `${cesta.length} producto${cesta.length!==1?'s':''} distinto${cesta.length!==1?'s':''}` : 'Agrega un producto para empezar.'}</p></div><ReceiptText size={23}/></div>
        <div className="commerce-cart">{!cesta.length?<div className="commerce-cart-empty"><ShoppingBag size={36}/><strong>Tu carrito está vacío</strong><p>Selecciona artículos a la izquierda para preparar la venta.</p></div>:cesta.map(p=><div className="commerce-cart-item" key={p.id}><div className="commerce-cart-meta"><strong>{p.nombre}</strong><small>{CLP(p.precio)} por unidad</small></div><button type="button" className="commerce-remove" aria-label={`Quitar ${p.nombre}`} onClick={()=>cambiarCantidad(p.id,0)}><Trash2 size={16}/></button><div className="commerce-qty"><button type="button" aria-label={`Quitar una unidad de ${p.nombre}`} onClick={()=>cambiarCantidad(p.id,p.cantidad-1)}><Minus size={16}/></button><input type="number" aria-label={`Cantidad de ${p.nombre}`} min={1} max={p.stock} value={p.cantidad} onChange={e=>cambiarCantidad(p.id,Number(e.target.value))}/><button type="button" aria-label={`Añadir una unidad de ${p.nombre}`} onClick={()=>cambiarCantidad(p.id,p.cantidad+1)}><Plus size={16}/></button></div><b className="commerce-line-total">{CLP(p.subtotal)}</b></div>)}</div>
        <div className="commerce-pay"><div className="commerce-total"><span>Total a cobrar</span><strong>{CLP(total)}</strong></div><label className="commerce-pay-label">¿Cómo pagó el cliente?</label><div className="commerce-methods"><button type="button" className={medio==='efectivo'?'active':''} onClick={()=>elegirMedio('efectivo')}><Banknote size={20}/> Efectivo <small>Alt+1</small></button><button type="button" className={medio==='tarjeta'?'active':''} onClick={()=>elegirMedio('tarjeta')}><CreditCard size={20}/> Tarjeta <small>Alt+2</small></button></div>
          {medio==='efectivo'?<><label className="commerce-input-label" htmlFor="commerce-cash">Dinero recibido</label><input id="commerce-cash" type="number" min={0} max={2147483647} placeholder="Monto en pesos" value={recibido} onChange={e=>cambiarRecibido(e.target.value)}/><div className="commerce-change">Vuelto para el cliente <strong>{vuelto===null?'—':CLP(vuelto)}</strong></div></>:<p className="commerce-card-note">Este sistema registra el pago como tarjeta. No realiza un cobro bancario real.</p>}
          <button type="button" className="button primary commerce-finish" disabled={!sePuedePagar || ocupado} onClick={()=>setConfirmar(true)}><CheckCircle2 size={19}/> Revisar y cobrar</button><p className="commerce-shortcut"><Keyboard size={15}/> F2 buscar · Enter agregar · Ctrl+Enter revisar cobro</p>
        </div></section>
    </div>}
    {estado && vista==='caja' && <div className="commerce-cash-layout">
      {!caja?<section className="card commerce-panel"><div className="commerce-panel-heading"><span className="commerce-panel-icon"><Wallet size={25}/></span><div><h2>Comienza tu turno</h2><p>Cuenta el efectivo que ya tienes en la caja e ingrésalo aquí.</p></div></div><form onSubmit={abrir} className="commerce-form"><label>Dinero inicial en caja (CLP)<input type="number" autoFocus min="0" max="2147483647" required value={fondo} onChange={e=>setFondo(e.target.value)} placeholder="Ej.: 30000"/></label><button className="button primary" type="submit" disabled={ocupado || !Number.isSafeInteger(numero(fondo))}>Abrir caja y empezar <ChevronRight size={18}/></button></form></section>:<>
        <section className="card commerce-panel"><div className="commerce-panel-heading"><span className="commerce-panel-icon"><Wallet size={26}/></span><div><h2>Tu caja está abierta</h2><p>Abierta por {caja.responsable} · {corto(caja.fecha_apertura)}</p></div></div>
          <div className="commerce-cash-summary"><div><span>Efectivo esperado</span><strong>{CLP(caja.saldo_esperado)}</strong></div><div><span>Ventas en efectivo</span><strong>{CLP(caja.ventas_efectivo)}</strong></div><div><span>Ventas con tarjeta</span><strong>{CLP(caja.ventas_tarjeta)}</strong></div><div><span>Ventas del turno</span><strong>{caja.total_ventas}</strong></div></div>
          <div className="commerce-cash-actions"><button className="button secondary" onClick={()=>setMostrarMovimiento(v=>!v)} type="button"><ArrowDownCircle size={18}/> Registrar movimiento</button><button className="button primary" type="button" onClick={()=>setMostrarCierre(v=>!v)}><CheckCircle2 size={18}/> Cerrar turno</button></div>
          {mostrarMovimiento && <form onSubmit={movimiento} className="commerce-inline-form"><h3>Movimiento de efectivo</h3><div className="commerce-form-grid"><label>Movimiento<select value={tipoMovimiento} onChange={e=>setTipoMovimiento(e.target.value as 'ingreso'|'retiro')}><option value="ingreso">Ingreso de dinero</option><option value="retiro">Retiro de dinero</option></select></label><label>Monto<input type="number" min="1" max="2147483647" required value={montoMovimiento} onChange={e=>setMontoMovimiento(e.target.value)}/></label></div><label>Motivo<input minLength={3} maxLength={200} required placeholder="Ej.: Compra de insumos" value={motivoMovimiento} onChange={e=>setMotivoMovimiento(e.target.value)}/></label><div className="commerce-inline-actions"><button type="button" className="button secondary" onClick={()=>setMostrarMovimiento(false)}>Cancelar</button><button className="button primary" disabled={ocupado} type="submit">Guardar movimiento</button></div></form>}
          {mostrarCierre && <form onSubmit={cerrar} className="commerce-inline-form commerce-closing"><h3>Antes de cerrar, cuenta el efectivo</h3><p>Lo esperado es {CLP(caja.saldo_esperado)}. Anota cuánto dinero tienes realmente, incluyendo el fondo inicial.</p><label>Dinero contado en caja<input min="0" max="2147483647" type="number" required value={contado} onChange={e=>setContado(e.target.value)} placeholder="Monto en pesos"/></label>{Number.isSafeInteger(numero(contado)) && <div className="commerce-difference">Diferencia: <strong>{CLP(numero(contado)-caja.saldo_esperado)}</strong></div>}<div className="commerce-inline-actions"><button type="button" className="button secondary" onClick={()=>setMostrarCierre(false)}>Cancelar</button><button className="button primary" disabled={ocupado} type="submit">Confirmar cierre</button></div><small>Al cerrar se guarda automáticamente una copia local de la base de datos.</small></form>}
        </section>
        <section className="card commerce-panel"><div className="commerce-section-header"><div><h2>Movimientos de efectivo</h2><p>Ingresos y retiros registrados en este turno.</p></div></div>{caja.movimientos?.length?<div className="commerce-movements">{caja.movimientos.map(m=><div key={m.id} className="commerce-movement"><span className={`commerce-movement-icon ${m.tipo}`}>{m.tipo==='ingreso'?<ArrowDownCircle size={19}/>:<ArrowUpCircle size={19}/>}</span><span><strong>{m.motivo}</strong><small>{corto(m.fecha_hora)} · {m.usuario}</small></span><b>{m.tipo==='ingreso'?'+':'−'}{CLP(m.monto)}</b></div>)}</div>:<div className="commerce-note">Aún no hay ingresos o retiros registrados.</div>}</section>
      </>}
      <section className="card commerce-panel"><div className="commerce-section-header"><div><h2>Turnos anteriores</h2><p>Cierres que han quedado registrados.</p></div></div><div className="commerce-turns">{estado.historial.filter(c=>c.fecha_cierre).slice(0,8).map(c=><div key={c.id} className="commerce-turn"><span>Turno #{c.id}<small>{corto(c.fecha_apertura)} · {c.responsable}</small></span><span><b>{CLP(c.saldo_esperado)}</b><small>Diferencia {CLP(c.diferencia ?? 0)}</small></span></div>)}{!estado.historial.some(c=>c.fecha_cierre) && <div className="commerce-note">Todavía no hay turnos cerrados.</div>}</div></section>
      {admin && <section className="card commerce-panel"><div className="commerce-section-header"><div><h2>Preferencias y seguridad</h2><p>Opciones disponibles solo para el administrador.</p></div><Settings2 size={21}/></div><div className="commerce-admin-actions"><button className="button secondary" type="button" onClick={()=>setVerAjustes(!verAjustes)}><CalendarClock size={18}/> Avisos de vencimiento</button><button className="button secondary" disabled={ocupado} type="button" onClick={descargar}><Download size={18}/> Descargar respaldo</button></div>{verAjustes&&<form onSubmit={guardarAjustes} className="commerce-inline-form"><label>Avisar productos que vencen dentro de (días)<input type="number" min={1} max={90} value={diasAviso} required onChange={e=>setDiasAviso(e.target.value)}/></label><button className="button primary" disabled={ocupado} type="submit">Guardar preferencias</button></form>}<p className="commerce-panel-foot">El respaldo contiene información sensible. Guárdalo en una unidad segura, fuera del computador de caja.</p></section>}
    </div>}
    {estado && vista==='historial' && <section className="card commerce-panel"><div className="commerce-section-header"><div><h2>Ventas registradas</h2><p>{admin?'Últimas 100 ventas del negocio.':'Tus últimas 100 ventas.'} Selecciona una para revisar el detalle.</p></div><button type="button" className="button secondary" disabled={ocupado} onClick={cargarHistorial}><RefreshCw size={17}/> Actualizar</button></div>{!historial.length?<div className="commerce-note">Todavía no hay ventas en el historial o no se han podido cargar.</div>:<div className="commerce-history">{historial.map(v=><details key={v.id} className="commerce-history-entry"><summary><span><ReceiptText size={20}/><strong>Venta #{v.id}</strong><small>{corto(v.fecha_hora)} · {v.usuario}</small></span><span><b>{CLP(v.total)}</b><small>{v.metodo_pago==='efectivo'?'Efectivo':'Tarjeta'}</small></span></summary><div className="commerce-history-detail">{v.items?.map((i,idx)=><div key={idx}><span>{i.cantidad} × {i.nombre}</span><b>{CLP(i.subtotal)}</b></div>)}{v.metodo_pago==='efectivo' && <><div><span>Recibido</span><b>{CLP(v.monto_recibido)}</b></div><div><span>Vuelto</span><b>{CLP(v.vuelto)}</b></div></>}<small>Comprobante interno, no tributario.</small></div></details>)}</div>}</section>}
    {confirmar && <div className="commerce-modal-backdrop" role="presentation" onMouseDown={e=>{if(e.target===e.currentTarget && !ocupado) setConfirmar(false);}}><section className="commerce-modal" role="dialog" aria-modal="true" aria-label="Confirmar venta"><span className="commerce-modal-icon"><CheckCircle2 size={27}/></span><h2>¿Confirmamos el cobro?</h2><p>Se guardará la venta y se descontarán {cesta.reduce((a,p)=>a+p.cantidad,0)} unidades del inventario.</p><div className="commerce-confirm-total"><span>Total</span><strong>{CLP(total)}</strong></div><p className="commerce-modal-sub">{medio==='efectivo'?`Efectivo: ${CLP(efectivo)} · Vuelto: ${CLP(vuelto||0)}`:'Pago con tarjeta registrado manualmente.'}</p><div className="commerce-modal-actions"><button type="button" className="button secondary" disabled={ocupado} onClick={()=>setConfirmar(false)}>Volver</button><button type="button" className="button primary" autoFocus disabled={!sePuedePagar||ocupado} onClick={registrarVenta}>{ocupado?'Guardando…':'Confirmar venta'} <Check size={18}/></button></div></section></div>}
    {ticket && <div className="commerce-modal-backdrop"><section className="commerce-modal commerce-receipt-modal" role="dialog" aria-modal="true" aria-label="Venta confirmada"><span className="commerce-modal-icon"><CheckCircle2 size={28}/></span><h2>¡Venta registrada!</h2><p>Se guardó la transacción y se actualizó el inventario.</p><div className="commerce-ticket" id="nexo-ticket"><h3>Merqia · Comprobante interno</h3><small>NO VÁLIDO COMO BOLETA TRIBUTARIA</small><p>Venta #{ticket.id} · {corto(ticket.fecha_hora)}</p>{ticket.items?.map((i,idx)=><div className="commerce-ticket-line" key={idx}><span>{i.cantidad} × {i.nombre}</span><strong>{CLP(i.subtotal)}</strong></div>)}<div className="commerce-ticket-total"><b>Total</b><b>{CLP(ticket.total)}</b></div><div className="commerce-ticket-line"><span>Medio de pago</span><strong>{ticket.metodo_pago==='efectivo'?'Efectivo':'Tarjeta (registro)'}</strong></div>{ticket.metodo_pago==='efectivo'&&<><div className="commerce-ticket-line"><span>Recibido</span><strong>{CLP(ticket.monto_recibido)}</strong></div><div className="commerce-ticket-line"><span>Vuelto</span><strong>{CLP(ticket.vuelto)}</strong></div></>}</div><div className="commerce-modal-actions"><button type="button" className="button secondary" onClick={()=>window.print()}><Printer size={17}/> Imprimir</button><button type="button" className="button primary" onClick={()=>{setTicket(null);setBusqueda('');buscador.current?.focus();}}>Nueva venta <ChevronRight size={18}/></button></div></section></div>}
  </div>;
}
function Tab({icon:Icon,label,activo,onClick}:{icon:LucideIcon;label:string;activo:boolean;onClick:()=>void}) {
  return <button type="button" role="tab" aria-selected={activo} className={`commerce-tab ${activo?'active':''}`} onClick={onClick}><Icon size={18}/>{label}</button>;
}
