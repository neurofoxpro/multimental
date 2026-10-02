using System;
using System.Text;
using System.Runtime.InteropServices;
using System.Collections.Generic;
public sealed class MultimentalBluetoothChannel : IDisposable {
 [StructLayout(LayoutKind.Sequential,Pack=1)] struct Address { public ushort family; public ulong bluetooth; public Guid service; public uint port; }
 [DllImport("ws2_32.dll")] static extern int WSAStartup(ushort version, IntPtr data);
 [DllImport("ws2_32.dll")] static extern int WSACleanup();
 [DllImport("ws2_32.dll")] static extern int WSAGetLastError();
 [DllImport("ws2_32.dll")] static extern IntPtr socket(int family,int type,int protocol);
 [DllImport("ws2_32.dll")] static extern int connect(IntPtr socket,ref Address addr,int len);
 [DllImport("ws2_32.dll")] static extern int send(IntPtr socket,byte[] data,int len,int flags);
 [DllImport("ws2_32.dll")] static extern int recv(IntPtr socket,byte[] data,int len,int flags);
 [DllImport("ws2_32.dll")] static extern int setsockopt(IntPtr socket,int level,int name,ref int value,int len);
 [DllImport("ws2_32.dll")] static extern int closesocket(IntPtr socket);
 IntPtr handle=new IntPtr(-1);bool initialized=false;
 public MultimentalBluetoothChannel(string address) : this(address,"7e120e58-6fbd-4e4f-80e8-5685947c9dab",false) {}
 public MultimentalBluetoothChannel(string address,string service,bool secure) {
  IntPtr data=Marshal.AllocHGlobal(512);
  try{int result=WSAStartup(0x0202,data);if(result!=0)throw new Exception("WSAStartup failed "+result);initialized=true;}finally{Marshal.FreeHGlobal(data);}
  try{handle=socket(32,1,3);if(handle==new IntPtr(-1))throw new Exception("Bluetooth socket unavailable "+WSAGetLastError());
   int timeout=8000;setsockopt(handle,0xffff,0x1006,ref timeout,4);setsockopt(handle,0xffff,0x1005,ref timeout,4);
   if(secure){int yes=1;if(setsockopt(handle,3,unchecked((int)0x80000001),ref yes,4)!=0||setsockopt(handle,3,2,ref yes,4)!=0)throw new Exception("Secure Bluetooth options failed "+WSAGetLastError());}
   Address a=new Address{family=32,bluetooth=Convert.ToUInt64(address.Replace(":",""),16),service=new Guid(service),port=0};
   if(Marshal.SizeOf(a)!=30)throw new Exception("Unexpected SOCKADDR_BTH layout");
   if(connect(handle,ref a,30)!=0)throw new Exception("RFCOMM connect failed "+WSAGetLastError());
  }catch{Dispose();throw;}
 }
 public string Exchange(string line) { SendLine(line);return ReadLine(); }
 public void SendLine(string line) {
  byte[] all=Encoding.UTF8.GetBytes(line+"\n");int offset=0;
  while(offset<all.Length){byte[] part=new byte[all.Length-offset];Array.Copy(all,offset,part,0,part.Length);int n=send(handle,part,part.Length,0);if(n<=0)throw new Exception("RFCOMM send failed "+WSAGetLastError());offset+=n;}
 }
 public string ReadLine() {
  var bytes=new List<byte>();byte[] one=new byte[1];
  while(bytes.Count<32768){int n=recv(handle,one,1,0);if(n<=0)throw new Exception("RFCOMM receive failed "+WSAGetLastError());if(one[0]==10)return Encoding.UTF8.GetString(bytes.ToArray());bytes.Add(one[0]);}
  throw new Exception("RFCOMM frame oversized");
 }
 public void Dispose(){if(handle!=new IntPtr(-1)){closesocket(handle);handle=new IntPtr(-1);}if(initialized){WSACleanup();initialized=false;}}
}
