using System;
using System.Diagnostics;
using System.IO;
using System.Net;
using System.Reflection;
using System.Windows.Forms;

[assembly: AssemblyTitle("LG Campaign")]
[assembly: AssemblyProduct("LG Campaign Client")]
[assembly: AssemblyVersion("1.0.0.0")]

internal static class Client
{
    private const string Server = "https://setads.click/";

    [STAThread]
    private static int Main(string[] args)
    {
        Application.EnableVisualStyles();
        bool checkOnly = args.Length == 1 && args[0] == "--check";
        string edge = FindEdge();
        if (edge == null)
        {
            if (!checkOnly) MessageBox.Show("Cần Microsoft Edge để mở LG Campaign. Hãy cài Edge rồi mở lại ứng dụng.", "LG Campaign", MessageBoxButtons.OK, MessageBoxIcon.Information);
            return 2;
        }
        do
        {
            if (CanConnect()) break;
            if (checkOnly) return 3;
            if (MessageBox.Show("Chưa kết nối được server LG Campaign.\n\nKiểm tra Internet và kết nối Tailscale được quản trị viên cấp. Nếu vẫn lỗi, liên hệ người quản trị server.\n\nBấm Retry để thử lại.", "LG Campaign", MessageBoxButtons.RetryCancel, MessageBoxIcon.Warning) != DialogResult.Retry) return 3;
        } while (true);
        if (checkOnly) return 0;
        try
        {
            Process.Start(new ProcessStartInfo(edge, "--app=" + Server) { UseShellExecute = false });
            return 0;
        }
        catch
        {
            MessageBox.Show("Không mở được Microsoft Edge. Hãy thử mở Edge trước, rồi chạy lại LG Campaign.", "LG Campaign", MessageBoxButtons.OK, MessageBoxIcon.Error);
            return 4;
        }
    }

    private static string FindEdge()
    {
        foreach (string root in new[] { Environment.GetFolderPath(Environment.SpecialFolder.ProgramFilesX86), Environment.GetFolderPath(Environment.SpecialFolder.ProgramFiles), Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData) })
        {
            if (String.IsNullOrEmpty(root)) continue;
            string path = Path.Combine(root, "Microsoft", "Edge", "Application", "msedge.exe");
            if (File.Exists(path)) return path;
        }
        return null;
    }

    private static bool CanConnect()
    {
        try
        {
            ServicePointManager.SecurityProtocol = SecurityProtocolType.Tls12;
            var request = (HttpWebRequest)WebRequest.Create(Server + "api/health");
            request.Timeout = 12000;
            request.ReadWriteTimeout = 12000;
            request.AllowAutoRedirect = false;
            using (var response = (HttpWebResponse)request.GetResponse())
            using (var reader = new StreamReader(response.GetResponseStream()))
            {
                return response.StatusCode == HttpStatusCode.OK && reader.ReadToEnd().Replace(" ", "").Contains("\"ok\":true");
            }
        }
        catch { return false; }
    }
}
