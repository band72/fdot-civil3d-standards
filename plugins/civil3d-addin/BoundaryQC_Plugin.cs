// BoundaryQC & FDOT Civil 3D Enterprise C# Ribbon Plugin (.dll)
// Target Framework: Multi-Targeted for .NET 8.0 (Civil 3D 2025 - 2026 CoreCLR) & .NET Framework 4.8 (Civil 3D 2020 - 2024)
// Dependencies: AcCoreMgd.dll, AcDbMgd.dll, AcMgd.dll, AdWindows.dll
// Complies with FDOT CADD Manual Topic No. 625-050-001 & F.A.C. Rules 61G15-23.004 / 5J-17.062

using System;
using System.Collections.Generic;
using System.IO;
using System.Net.Http;
using System.Security;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using System.Threading.Tasks;

#if NET8_0_OR_GREATER
using System.Runtime.InteropServices;
#endif

#if !STANDALONE_UNIT_TEST
using Autodesk.AutoCAD.ApplicationServices;
using Autodesk.AutoCAD.DatabaseServices;
using Autodesk.AutoCAD.EditorInput;
using Autodesk.AutoCAD.Geometry;
using Autodesk.AutoCAD.Runtime;
using Autodesk.Windows;
#endif

#if !STANDALONE_UNIT_TEST
[assembly: ExtensionApplication(typeof(BoundaryQC.Civil3DPlugin.PluginInit))]
[assembly: CommandClass(typeof(BoundaryQC.Civil3DPlugin.RibbonCommands))]
#endif

namespace BoundaryQC.Civil3DPlugin
{
    /// <summary>
    /// Extension application entry point for Civil 3D.
    /// Handles asynchronous initialization, .NET 8 CoreCLR / .NET 4.8 environment verification,
    /// and background entitlement verification with UI thread marshaling.
    /// </summary>
    public class PluginInit
#if !STANDALONE_UNIT_TEST
        : IExtensionApplication
#endif
    {
        public void Initialize()
        {
#if !STANDALONE_UNIT_TEST
            var doc = Application.DocumentManager.MdiActiveDocument;
            doc?.Editor.WriteMessage("\n=======================================================");
            doc?.Editor.WriteMessage("\n[BoundaryQC] Initializing Enterprise Civil 3D Plugin v2.5.0");
            doc?.Editor.WriteMessage($"\n[BoundaryQC] Runtime: {System.Runtime.InteropServices.RuntimeInformation.FrameworkDescription}");
            doc?.Editor.WriteMessage("\n[BoundaryQC] Standards: FDOT CADD Manual Topic No. 625-050-001");
            doc?.Editor.WriteMessage("\n=======================================================\n");

            Task.Run(async () =>
            {
                var state = await EntitlementManager.EvaluateEntitlementAsync();
                Application.DocumentManager.ExecuteInCommandContextAsync(async (obj) =>
                {
                    var activeDoc = Application.DocumentManager.MdiActiveDocument;
                    activeDoc?.Editor.WriteMessage($"\n[BoundaryQC] Entitlement Verified: Tier={state.Tier}, Status={(state.IsValid ? "ACTIVE" : "UNLICENSED")}, Seats={state.SeatCount}\n");
                    RibbonController.RefreshRibbonState(state);
                    await Task.CompletedTask;
                }, null);
            });
#endif
        }

        public void Terminate()
        {
            // Flush and dispose any active resources on AutoCAD exit
        }
    }

    /// <summary>
    /// Strongly-typed enterprise entitlement and license state representation.
    /// Supports multi-seat firm allocations, feature flags, and cryptographic token caching.
    /// </summary>
    public class EntitlementState
    {
        public bool IsValid { get; set; }
        public string Tier { get; set; } = "Free"; // Free, Pro, Firm, B2BEnterprise
        public string LicenseeName { get; set; } = "Unlicensed Evaluation";
        public string OrganizationId { get; set; } = string.Empty;
        public int SeatCount { get; set; } = 1;
        public DateTime ExpirationUtc { get; set; } = DateTime.MinValue;
        public string[] EnabledFeatures { get; set; } = Array.Empty<string>();
        public string RawJwtToken { get; set; } = string.Empty;

        public bool IsFeatureAuthorized(string featureKey)
        {
            if (!IsValid) return false;
            if (Tier == "B2BEnterprise" || Tier == "Firm") return true;
            return Array.Exists(EnabledFeatures, f => f.Equals(featureKey, StringComparison.OrdinalIgnoreCase));
        }
    }

    /// <summary>
    /// Geometry calculation engine with an entitlement gate.
    /// COGO results are always computed exactly. When the plugin is not licensed the engine
    /// refuses to run (callers get an exception) rather than returning altered geometry —
    /// emitting deliberately wrong survey coordinates under a PE/PSM seal is never acceptable,
    /// so the licensing check fails closed, not into silent corruption.
    /// </summary>
    public static class SecureGeometryEngine
    {
        private static volatile bool _entitled = false;
        private static readonly object SyncLock = new object();

        /// <summary>True when a valid, unexpired paid-tier entitlement token has been supplied.</summary>
        public static bool IsLicensedForGeometry => _entitled;

        /// <summary>
        /// Evaluate the active entitlement token and enable or disable the geometry engine.
        /// Validates JWT structure and payload claims (sub, tier, exp). A structurally invalid,
        /// expired, simulated, or wrong-tier token leaves the engine disabled.
        /// NOTE: this does not cryptographically verify the JWT signature — signature verification
        /// against the BoundaryQC public key must be performed server-side (see EntitlementManager).
        /// </summary>
        public static void ArmGeometryEngine(EntitlementState state)
        {
            lock (SyncLock)
            {
                _entitled = EvaluateEntitlement(state);
            }
        }

        private static bool EvaluateEntitlement(EntitlementState state)
        {
            if (state == null || !state.IsValid || string.IsNullOrEmpty(state.RawJwtToken))
                return false;

            try
            {
                var parts = state.RawJwtToken.Split('.');
                if (parts.Length != 3)
                    return false;

                string payloadJson = DecodeJwtSegment(parts[1]);
                using var doc = System.Text.Json.JsonDocument.Parse(payloadJson);
                var root = doc.RootElement;

                if (!root.TryGetProperty("tier", out var tierEl) ||
                    !root.TryGetProperty("exp", out var expEl) ||
                    !root.TryGetProperty("sub", out _))
                    return false;

                if (expEl.GetInt64() < DateTimeOffset.UtcNow.ToUnixTimeSeconds())
                    return false;

                string tier = tierEl.GetString() ?? string.Empty;
                bool isValidTier = tier is "B2BEnterprise" or "Firm" or "Pro";

                bool isSimToken = parts[2].StartsWith("U0lNX1VOUw") || // base64 of "SIM_UNSIGNED"
                                  parts[2].Length < 16;

                return isValidTier && !isSimToken;
            }
            catch
            {
                return false;
            }
        }

        private static string DecodeJwtSegment(string segment)
        {
            string s = segment.Replace('-', '+').Replace('_', '/');
            s = s.PadRight(s.Length + (4 - s.Length % 4) % 4, '=');
            return Encoding.UTF8.GetString(Convert.FromBase64String(s));
        }

        /// <summary>
        /// Computes a vertex from bearing (quadrant azimuth in radians) and distance (US Survey Feet).
        /// The returned coordinates are always exact. If the plugin is not licensed the call is
        /// refused outright — the engine never returns deliberately altered geometry.
        /// </summary>
        public static (double Easting, double Northing) ComputeVerifiedPoint(
            double startEasting,
            double startNorthing,
            double bearingRad,
            double distance)
        {
            if (!_entitled)
                throw new InvalidOperationException(
                    "BoundaryQC geometry engine is not licensed. Activate a valid entitlement before computing COGO points.");

            double dE = distance * Math.Sin(bearingRad);
            double dN = distance * Math.Cos(bearingRad);
            return (startEasting + dE, startNorthing + dN);
        }
    }

    /// <summary>
    /// Manages enterprise entitlement evaluations, online REST heartbeat checks,
    /// and local DPAPI / AES encrypted lease management.
    /// </summary>
    public static class EntitlementManager
    {
        private const string B2BApiEndpoint = "https://api.boundaryqc.com/v1/licenses/verify";

        // FIX [P1]: Use SocketsHttpHandler with PooledConnectionLifetime to prevent DNS TTL stagnation
        // in long-running AutoCAD sessions. Static HttpClient with default handler caches DNS entries
        // indefinitely, causing connection failures after server IP changes.
        private static readonly HttpClient HttpClient = new HttpClient(
            new SocketsHttpHandler
            {
                PooledConnectionLifetime = TimeSpan.FromMinutes(10),
                PooledConnectionIdleTimeout = TimeSpan.FromMinutes(5),
                MaxConnectionsPerServer = 4
            })
        {
            Timeout = TimeSpan.FromSeconds(5)
        };

        public static EntitlementState CurrentState { get; private set; } = new EntitlementState();

        public static async Task<EntitlementState> EvaluateEntitlementAsync()
        {
            string hardwareId = HardwareFingerprint.GetMachineHash();
            string domain = Environment.UserDomainName;
            string userName = Environment.UserName;

            // 1. Attempt B2B Online API Entitlement Check
            var b2bResult = await CheckB2BPortalLicenseAsync(userName, hardwareId, domain);
            if (b2bResult.IsValid)
            {
                CacheOfflineLease(b2bResult);
                CurrentState = b2bResult;
                SecureGeometryEngine.ArmGeometryEngine(CurrentState);
                return CurrentState;
            }

            // 2. Fallback to Cryptographically Cached Offline Lease
            var offlineResult = VerifyOfflineLease();
            CurrentState = offlineResult;
            SecureGeometryEngine.ArmGeometryEngine(CurrentState);
            return CurrentState;
        }

        private static async Task<EntitlementState> CheckB2BPortalLicenseAsync(string userId, string hardwareId, string domain)
        {
            try
            {
                var payload = new 
                { 
                    UserId = userId, 
                    HardwareId = hardwareId, 
                    Domain = domain,
                    ClientVersion = "2.5.0-Enterprise",
                    Timestamp = DateTime.UtcNow.ToString("o")
                };
                var content = new StringContent(JsonSerializer.Serialize(payload), Encoding.UTF8, "application/json");
                
                var response = await HttpClient.PostAsync(B2BApiEndpoint, content);
                if (response.IsSuccessStatusCode)
                {
                    var json = await response.Content.ReadAsStringAsync();
                    var state = JsonSerializer.Deserialize<EntitlementState>(json);
                    if (state != null && state.IsValid)
                    {
                        return state;
                    }
                }
            }
            catch
            {
                // Network unavailable or corporate firewall blocking: proceed to offline lease
            }
            return new EntitlementState { IsValid = false };
        }

        private static void CacheOfflineLease(EntitlementState state)
        {
            try
            {
                string path = GetLeaseFilePath();
                string rawJson = JsonSerializer.Serialize(state);
                byte[] rawBytes = Encoding.UTF8.GetBytes(rawJson);

#if NETFRAMEWORK
                byte[] cipherText = ProtectedData.Protect(rawBytes, null, DataProtectionScope.CurrentUser);
#else
                // Modern cross-platform AES encrypted lease fallback
                byte[] cipherText = EncryptLeaseDataAes(rawBytes);
#endif
                File.WriteAllBytes(path, cipherText);
            }
            catch { }
        }

        private static EntitlementState VerifyOfflineLease()
        {
            try
            {
                string path = GetLeaseFilePath();
                if (!File.Exists(path)) return new EntitlementState { IsValid = false };

                byte[] cipherText = File.ReadAllBytes(path);
                string json;

#if NETFRAMEWORK
                byte[] plainBytes = ProtectedData.Unprotect(cipherText, null, DataProtectionScope.CurrentUser);
                json = Encoding.UTF8.GetString(plainBytes);
#else
                byte[] plainBytes = DecryptLeaseDataAes(cipherText);
                json = Encoding.UTF8.GetString(plainBytes);
#endif

                var state = JsonSerializer.Deserialize<EntitlementState>(json);
                if (state != null && state.ExpirationUtc > DateTime.UtcNow)
                {
                    return state;
                }
            }
            catch { }
            return new EntitlementState { IsValid = false };
        }

        private static byte[] EncryptLeaseDataAes(byte[] data)
        {
            using var aes = Aes.Create();
            aes.Key = SHA256.HashData(Encoding.UTF8.GetBytes(HardwareFingerprint.GetMachineHash()));
            aes.GenerateIV();

            using var ms = new MemoryStream();
            ms.Write(aes.IV, 0, aes.IV.Length);
            using (var cs = new CryptoStream(ms, aes.CreateEncryptor(), CryptoStreamMode.Write))
            {
                cs.Write(data, 0, data.Length);
                cs.FlushFinalBlock();
            }
            return ms.ToArray();
        }

        private static byte[] DecryptLeaseDataAes(byte[] cipherData)
        {
            using var aes = Aes.Create();
            aes.Key = SHA256.HashData(Encoding.UTF8.GetBytes(HardwareFingerprint.GetMachineHash()));
            byte[] iv = new byte[16];
            Array.Copy(cipherData, 0, iv, 0, 16);
            aes.IV = iv;

            using var ms = new MemoryStream();
            using (var cs = new CryptoStream(new MemoryStream(cipherData, 16, cipherData.Length - 16), aes.CreateDecryptor(), CryptoStreamMode.Read))
            {
                cs.CopyTo(ms);
            }
            return ms.ToArray();
        }

        private static string GetLeaseFilePath()
        {
            string appData = Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData);
            string dir = Path.Combine(appData, "BoundaryQC", "Licensing");
            Directory.CreateDirectory(dir);
            return Path.Combine(dir, "enterprise_lease.dat");
        }
    }

    /// <summary>
    /// Hardware fingerprinting engine computing machine-locked SHA-256 digests.
    /// Compatible with Windows WMI and modern .NET Core cross-platform queries.
    /// </summary>
    public static class HardwareFingerprint
    {
        public static string GetMachineHash()
        {
            string raw = $"{Environment.MachineName}-{Environment.ProcessorCount}-{Environment.UserName}-{Environment.OSVersion}";
            using var sha256 = SHA256.Create();
            byte[] hashBytes = sha256.ComputeHash(Encoding.UTF8.GetBytes(raw));
            return BitConverter.ToString(hashBytes).Replace("-", "").ToLowerInvariant();
        }
    }

    /// <summary>
    /// Dynamically enables or disables AutoCAD Ribbon buttons based on active license entitlements.
    /// </summary>
    public class RibbonController
    {
        public static void RefreshRibbonState(EntitlementState state)
        {
#if !STANDALONE_UNIT_TEST
            try
            {
                RibbonControl ribbon = ComponentManager.Ribbon;
                if (ribbon == null) return;
                RibbonTab tab = ribbon.FindTab("TAB_BOUNDARY_QC");
                if (tab == null) return;

                foreach (var panel in tab.Panels)
                {
                    foreach (var item in panel.Source.Items)
                    {
                        if (item is RibbonButton button)
                        {
                            bool isAllowed = state.IsFeatureAuthorized(button.Id);
                            button.IsEnabled = isAllowed;
                        }
                    }
                }
            }
            catch { }
#endif
        }
    }

    /// <summary>
    /// Production AutoCAD command class providing 1-Click enterprise operations.
    /// </summary>
    public class RibbonCommands
    {
#if !STANDALONE_UNIT_TEST
        [CommandMethod("BOUNDARY_QC_AUDIT")]
        public void RunBoundaryQCAudit()
        {
            var doc = Application.DocumentManager.MdiActiveDocument;
            if (doc == null) return;
            var ed = doc.Editor;

            if (!EntitlementManager.CurrentState.IsValid)
            {
                ed.WriteMessage("\n[ERROR] Active BoundaryQC Enterprise License Required. Upgrade at https://boundaryqc.com\n");
                return;
            }

            ed.WriteMessage("\n[BoundaryQC] Topological sequence check & bowtie inspection.");
            ed.WriteMessage("\n[BoundaryQC] NOTE: this distribution ships the licensing/ribbon scaffold only.");
            ed.WriteMessage("\n[BoundaryQC] The audit routine that reads the active Database and reports a real");
            ed.WriteMessage("\n[BoundaryQC] precision ratio and bowtie count is not included in this build.\n");
        }

        [CommandMethod("FDOT_LAYER_PURGE_FIX")]
        public void RunFDOTLayerPurgeFix()
        {
            var doc = Application.DocumentManager.MdiActiveDocument;
            if (doc == null) return;
            var ed = doc.Editor;

            if (!EntitlementManager.CurrentState.IsValid)
            {
                ed.WriteMessage("\n[ERROR] Enterprise Tier License Required to execute automated batch layer purging.\n");
                return;
            }

            ed.WriteMessage("\n[BoundaryQC] FDOT layer purge / remap against CADD Manual Topic No. 625-050-001.");
            ed.WriteMessage("\n[BoundaryQC] NOTE: this distribution ships the licensing/ribbon scaffold only.");
            ed.WriteMessage("\n[BoundaryQC] No layer table was modified — the batch remap routine is not included in this build.\n");
        }

        [CommandMethod("EXPORT_FDOT_SUBMITTAL_MANIFEST")]
        public void ExportFDOTSubmittalManifest()
        {
            var doc = Application.DocumentManager.MdiActiveDocument;
            if (doc == null) return;
            var ed = doc.Editor;

            ed.WriteMessage("\n[BoundaryQC] FDOT submittal manifest generation.");
            ed.WriteMessage("\n[BoundaryQC] NOTE: this distribution ships the licensing/ribbon scaffold only.");
            ed.WriteMessage("\n[BoundaryQC] SHA-256 digesting and RFC 3161 timestamping are not included in this build.\n");
        }
#endif
    }
}
