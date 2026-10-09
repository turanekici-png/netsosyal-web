# NetSosyal - DEVRE DISI (2026-09-12).
#
# Bu script eskiden IKINCIL (10.20.1.100 / X:\ = \\10.20.1.100\Netsosyal.web)
# sunucu icin ayri bir standalone paket build edip oraya kopyaliyordu.
#
# Kullanici istegi (2026-09-12): artik 10.20.1.100'e HICBIR SEKILDE otomatik
# yayin YAPILMIYOR - sadece bu makine (birincil, netsosyal.sivas.bel.tr)
# yayinda. guncelle-yayinla.ps1 de ayni tarihte sadeleştirilip bu ikincil
# adimdan arindirildi.
#
# Eski script icerigi (referans icin) burada saklaniyor:
#   scripts\yayinla-iis.ps1.bak_20260912_deprecated
#
# 10.20.1.100'e tekrar yayin yapilmasi gerekirse (acikca istenirse) o yedek
# dosyadan geri alinabilir - aksi halde bu script kasitli olarak calismaz.

Write-Host ''
Write-Host 'Bu script devre disi birakildi (2026-09-12): 10.20.1.100 artik yayin hedefi degil.' -ForegroundColor Yellow
Write-Host 'Eski hali: scripts\yayinla-iis.ps1.bak_20260912_deprecated' -ForegroundColor Yellow
Write-Host ''
exit 1
