using System;
using System.Runtime.InteropServices;
public static class MultimentalPairing {
 [StructLayout(LayoutKind.Sequential)] struct FindParams { public uint size; }
 [StructLayout(LayoutKind.Sequential)] struct SystemTime { public ushort year,month,dayOfWeek,day,hour,minute,second,milliseconds; }
 [StructLayout(LayoutKind.Sequential,CharSet=CharSet.Unicode)] struct DeviceInfo {
  public uint size; public ulong address; public uint deviceClass;
  [MarshalAs(UnmanagedType.Bool)] public bool connected;
  [MarshalAs(UnmanagedType.Bool)] public bool remembered;
  [MarshalAs(UnmanagedType.Bool)] public bool authenticated;
  public SystemTime lastSeen,lastUsed;
  [MarshalAs(UnmanagedType.ByValTStr,SizeConst=248)] public string name;
 }
 public sealed class Result { public bool radioPresent,known,remembered,authenticated,connected; public uint lastError; }
 [DllImport("bthprops.cpl",SetLastError=true)] static extern IntPtr BluetoothFindFirstRadio(ref FindParams p,out IntPtr radio);
 [DllImport("bthprops.cpl",SetLastError=true)] [return:MarshalAs(UnmanagedType.Bool)] static extern bool BluetoothFindNextRadio(IntPtr search,out IntPtr radio);
 [DllImport("bthprops.cpl")] [return:MarshalAs(UnmanagedType.Bool)] static extern bool BluetoothFindRadioClose(IntPtr search);
 [DllImport("bthprops.cpl")] static extern uint BluetoothGetDeviceInfo(IntPtr radio,ref DeviceInfo info);
 [DllImport("kernel32.dll")] [return:MarshalAs(UnmanagedType.Bool)] static extern bool CloseHandle(IntPtr handle);
 public static Result Inspect(string selectedAddress) {
  if(!System.Text.RegularExpressions.Regex.IsMatch(selectedAddress,"^(?:[A-Fa-f0-9]{2}:){5}[A-Fa-f0-9]{2}$"))throw new ArgumentException("Explicit Bluetooth target required");
  var result=new Result();var p=new FindParams{size=(uint)Marshal.SizeOf(typeof(FindParams))};IntPtr radio;var search=BluetoothFindFirstRadio(ref p,out radio);
  if(search==IntPtr.Zero){result.lastError=(uint)Marshal.GetLastWin32Error();return result;}
  try{int limit=0;do{try{result.radioPresent=true;var info=new DeviceInfo{size=(uint)Marshal.SizeOf(typeof(DeviceInfo)),address=Convert.ToUInt64(selectedAddress.Replace(":",""),16)};var code=BluetoothGetDeviceInfo(radio,ref info);result.lastError=code;if(code==0){result.known=true;result.authenticated|=info.authenticated;result.remembered|=info.remembered;result.connected|=info.connected;}}finally{CloseHandle(radio);}limit++;}while(limit<8&&BluetoothFindNextRadio(search,out radio));}finally{BluetoothFindRadioClose(search);}return result;
 }
}
